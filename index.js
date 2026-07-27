const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onRequest } = require('firebase-functions/v2/https');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getMessaging } = require('firebase-admin/messaging');
const { getAuth } = require('firebase-admin/auth');

initializeApp();
const db = getFirestore();
const messaging = getMessaging();

// 본인 계정으로만 쓰는 개인 앱이므로 uid를 고정값으로 둡니다.
const OWNER_UID = 'dxiCIuJ2WuMEKs43yK5QHZWw0gy1';

// 앱 입장용 암호. 원하는 값으로 바꾸고 재배포하면 즉시 새 암호가 적용됩니다.
const PASSPHRASE = 'Ys468000';

// 이메일/비밀번호 로그인 대신 쓰는 간단한 암호 확인 + 로그인 토큰 발급 함수
exports.loginWithPassphrase = onRequest(async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
  if (req.method !== 'POST') { res.status(405).send('Method not allowed'); return; }

  const passphrase = (req.body && req.body.passphrase) || '';
  if (passphrase !== PASSPHRASE) {
    res.status(401).json({ error: '암호가 틀렸습니다.' });
    return;
  }
  try {
    const token = await getAuth().createCustomToken(OWNER_UID);
    res.json({ token });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const OFFSET_LABELS = { 15: '15분 전', 30: '30분 전', 60: '1시간 전', 120: '2시간 전', 1440: '1일 전', 2880: '2일 전', 10080: '1주일 전', 20160: '2주일 전' };

function advanceDueDate(dueAt, repeat) {
  const next = new Date(dueAt);
  if (repeat === 'daily') next.setDate(next.getDate() + 1);
  else if (repeat === 'weekly') next.setDate(next.getDate() + 7);
  else if (repeat === 'yearly') next.setFullYear(next.getFullYear() + 1);
  return next;
}

async function sendPush(token, title, body, reminderId) {
  await messaging.send({
    token,
    notification: { title, body },
    data: { reminderId },
    webpush: { fcmOptions: { link: '/' } },
  });
}

// 1분마다 실행: 리마인더별로 설정된 알림 시점(최대 2개, notifyOffsets)을 확인해 발송하고,
// 지정 시간(dueAt)에 도달하면 반복 주기에 따라 다음 회차로 갱신합니다.
exports.checkReminders = onSchedule('every 1 minutes', async () => {
  const now = new Date();
  const remindersRef = db.collection('users').doc(OWNER_UID).collection('reminders');
  const metaRef = db.collection('users').doc(OWNER_UID).collection('meta').doc('fcm');

  const [activeSnap, metaSnap] = await Promise.all([
    remindersRef.where('enabled', '==', true).get(),
    metaRef.get(),
  ]);

  if (activeSnap.empty) return;
  const token = metaSnap.exists ? metaSnap.data().token : null;
  if (!token) {
    console.log('등록된 FCM 토큰이 없습니다. 앱에서 알림 권한을 허용했는지 확인하세요.');
    return;
  }

  for (const docSnap of activeSnap.docs) {
    const r = docSnap.data();
    const dueAt = new Date(r.dueAt);
    const notifyOffsets = r.notifyOffsets || [];
    let sentOffsets = r.sentOffsets || [];
    const updates = {};
    let sentAnything = false;

    if (notifyOffsets.length > 0) {
      // 새 방식: 설정된 알림 시점(최대 2개)마다 발송
      for (const offset of notifyOffsets) {
        if (sentOffsets.includes(offset)) continue;
        const triggerTime = new Date(dueAt.getTime() - offset * 60000);
        if (triggerTime <= now) {
          try {
            await sendPush(token, '⏰ 리마인더', `${r.text} — ${OFFSET_LABELS[offset] || offset + '분 전'}`, docSnap.id);
            sentOffsets = [...sentOffsets, offset];
            sentAnything = true;
          } catch (e) {
            console.error('푸시 발송 실패:', docSnap.id, e.message);
          }
        }
      }

      if (dueAt <= now) {
        // 지정 시간 도달 - 반복이면 다음 회차로, 아니면 비활성화
        if (r.repeat && r.repeat !== 'none') {
          const next = advanceDueDate(dueAt, r.repeat);
          updates.dueAt = next.toISOString();
          updates.sentOffsets = [];
        } else {
          updates.enabled = false;
          updates.sentOffsets = sentOffsets;
        }
      } else if (sentAnything) {
        updates.sentOffsets = sentOffsets;
      }
    } else {
      // 예전 방식(알림 시점 미설정) - 지정 시간 자체에 1회 발송
      if (!r.notified && dueAt <= now) {
        try {
          await sendPush(token, '⏰ 리마인더', r.text, docSnap.id);
        } catch (e) {
          console.error('푸시 발송 실패:', docSnap.id, e.message);
          continue;
        }
        if (r.repeat && r.repeat !== 'none') {
          const next = advanceDueDate(dueAt, r.repeat);
          updates.dueAt = next.toISOString();
          updates.notified = false;
        } else {
          updates.notified = true;
        }
      }
    }

    if (Object.keys(updates).length > 0) {
      await docSnap.ref.update(updates);
    }
  }
});
