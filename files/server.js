const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');
require('dotenv').config();

const app = express();
app.use(cors({
  origin: '*'
}));
app.use(express.json());

// ─── Config ───────────────────────────────────────────────────────────────────

const ADMIN_KEY = process.env.ADMIN_KEY || 'wolt-lunch-2025';
const SHEET_ID = process.env.GOOGLE_SHEET_ID;

// Google Sheets JWT auth (service account)
const serviceAccountAuth = new JWT({
  email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

// Nodemailer transporter (Gmail or any SMTP)
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_APP_PASSWORD, // Gmail app password (not account password)
  },
});

// ─── Google Sheets helpers ─────────────────────────────────────────────────────

async function getDoc() {
  const doc = new GoogleSpreadsheet(SHEET_ID, serviceAccountAuth);
  await doc.loadInfo();
  return doc;
}

async function getSheet(doc, title) {
  let sheet = doc.sheetsByTitle[title];
  if (!sheet) {
    sheet = await doc.addSheet({ title, headerValues: getHeaders(title) });
  }
  return sheet;
}

function getHeaders(title) {
  if (title === 'Participants') return ['email', 'name', 'timestamp', 'matched', 'matchedWith'];
  if (title === 'Matches') return ['round', 'timestamp', 'person1_name', 'person1_email', 'person2_name', 'person2_email'];
  if (title === 'Rounds') return ['round', 'timestamp', 'pairs_count'];
  return [];
}

async function getParticipants(sheet) {
  const rows = await sheet.getRows();
  return rows.map(r => ({
    email: r.get('email'),
    name: r.get('name'),
    timestamp: r.get('timestamp'),
    matched: r.get('matched') === 'true',
    matchedWith: r.get('matchedWith') || '',
    _row: r,
  }));
}

// ─── Middleware ────────────────────────────────────────────────────────────────

function adminAuth(req, res, next) {
  const key = req.headers['x-admin-key'];
  if (key !== ADMIN_KEY) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// Public: register
app.post('/register', async (req, res) => {
  const { email, name } = req.body;
  if (!email || !name) return res.status(400).json({ error: 'Email and name required' });

  // Basic email validation
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Invalid email' });
  }

  try {
    const doc = await getDoc();
    const sheet = await getSheet(doc, 'Participants');
    const participants = await getParticipants(sheet);

    if (participants.find(p => p.email.toLowerCase() === email.toLowerCase())) {
      return res.status(409).json({ error: 'You\'re already registered!' });
    }

    await sheet.addRow({
      email: email.toLowerCase(),
      name,
      timestamp: new Date().toISOString(),
      matched: 'false',
      matchedWith: '',
    });

    res.json({ success: true, message: 'Registered successfully' });
  } catch (e) {
    console.error('Register error:', e);
    res.status(500).json({ error: 'Server error. Please try again.' });
  }
});

// Public: participant count
app.get('/count', async (req, res) => {
  try {
    const doc = await getDoc();
    const sheet = await getSheet(doc, 'Participants');
    const rows = await sheet.getRows();
    res.json({ count: rows.length });
  } catch (e) {
    res.json({ count: 0 });
  }
});

// Admin: list participants
app.get('/admin/participants', adminAuth, async (req, res) => {
  try {
    const doc = await getDoc();
    const sheet = await getSheet(doc, 'Participants');
    const participants = await getParticipants(sheet);

    const roundsSheet = await getSheet(doc, 'Rounds');
    const roundRows = await roundsSheet.getRows();

    res.json({
      participants: participants.map(({ _row, ...p }) => p),
      rounds: roundRows.length,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to load participants' });
  }
});

// Admin: run matching
app.post('/admin/match', adminAuth, async (req, res) => {
  try {
    const doc = await getDoc();
    const partSheet = await getSheet(doc, 'Participants');
    const matchSheet = await getSheet(doc, 'Matches');
    const roundsSheet = await getSheet(doc, 'Rounds');

    const all = await getParticipants(partSheet);
    const unmatched = all.filter(p => !p.matched);

    if (unmatched.length < 2) {
      return res.status(400).json({ error: 'Need at least 2 unmatched participants to run matching.' });
    }

    // Shuffle array (Fisher-Yates)
    const shuffled = [...unmatched];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    // Get current round number
    const roundRows = await roundsSheet.getRows();
    const roundNum = roundRows.length + 1;
    const now = new Date().toISOString();

    const pairs = [];
    let leftover = null;

    // If odd number, last person gets leftover flag (can be handled manually)
    for (let i = 0; i < shuffled.length - 1; i += 2) {
      pairs.push([shuffled[i], shuffled[i + 1]]);
    }
    if (shuffled.length % 2 !== 0) {
      leftover = shuffled[shuffled.length - 1];
    }

    // Update matched status in sheet + send emails
    const emailPromises = [];

    for (const [p1, p2] of pairs) {
      // Update rows
      p1._row.set('matched', 'true');
      p1._row.set('matchedWith', p2.email);
      await p1._row.save();

      p2._row.set('matched', 'true');
      p2._row.set('matchedWith', p1.email);
      await p2._row.save();

      // Log match
      await matchSheet.addRow({
        round: roundNum,
        timestamp: now,
        person1_name: p1.name,
        person1_email: p1.email,
        person2_name: p2.name,
        person2_email: p2.email,
      });

      // Send emails to both
      emailPromises.push(sendMatchEmail(p1, p2));
      emailPromises.push(sendMatchEmail(p2, p1));
    }

    await Promise.all(emailPromises);

    // Log round
    await roundsSheet.addRow({
      round: roundNum,
      timestamp: now,
      pairs_count: pairs.length,
    });

    res.json({
      matched: pairs.length,
      leftover: leftover ? leftover.name : null,
      round: roundNum,
    });

  } catch (e) {
    console.error('Match error:', e);
    res.status(500).json({ error: 'Matching failed: ' + e.message });
  }
});

// Admin: clear all participants
app.delete('/admin/clear', adminAuth, async (req, res) => {
  try {
    const doc = await getDoc();
    const sheet = await getSheet(doc, 'Participants');
    const rows = await sheet.getRows();
    for (const row of rows) await row.delete();
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to clear' });
  }
});

// ─── Email template ────────────────────────────────────────────────────────────

async function sendMatchEmail(recipient, match) {
  const subject = `🍱 Your Wolt Lunch Match is Here, ${recipient.name.split(' ')[0]}!`;

  const html = `
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8"/>
<style>
  body { margin:0; padding:0; background:#f4f7fb; font-family:'Helvetica Neue',Arial,sans-serif; }
  .wrapper { max-width:580px; margin:0 auto; padding:32px 16px; }
  .card {
    background:#ffffff;
    border-radius:20px;
    overflow:hidden;
    box-shadow:0 4px 24px rgba(0,0,0,0.08);
  }
  .header {
    background:linear-gradient(135deg,#009de0,#0080b8);
    padding:40px 36px;
    text-align:center;
  }
  .header .emoji { font-size:48px; margin-bottom:12px; display:block; }
  .header h1 {
    color:#fff;
    font-size:24px;
    font-weight:800;
    margin:0;
    letter-spacing:-0.5px;
  }
  .body { padding:36px; }
  .match-box {
    background:#f0f9ff;
    border:2px solid #009de0;
    border-radius:14px;
    padding:20px 24px;
    margin:24px 0;
    text-align:center;
  }
  .match-box .label { font-size:11px; color:#8ea6bc; text-transform:uppercase; letter-spacing:1px; margin-bottom:8px; }
  .match-box .name { font-size:22px; font-weight:800; color:#0d1b2a; }
  .match-box .email { font-size:14px; color:#009de0; margin-top:4px; }
  .steps { margin:24px 0; }
  .step {
    display:flex;
    align-items:flex-start;
    gap:14px;
    margin-bottom:16px;
    padding:16px;
    background:#fafbfc;
    border-radius:12px;
  }
  .step .icon { font-size:22px; flex-shrink:0; }
  .step .text { font-size:14px; color:#3a4a5a; line-height:1.6; }
  .step .text strong { color:#0d1b2a; display:block; margin-bottom:2px; }
  .selfie-box {
    background:linear-gradient(135deg,#00c9a7,#009de0);
    border-radius:14px;
    padding:20px 24px;
    text-align:center;
    color:#fff;
    margin:24px 0;
  }
  .selfie-box .big { font-size:32px; margin-bottom:8px; }
  .selfie-box p { margin:0; font-size:14px; line-height:1.6; }
  .footer {
    padding:20px 36px;
    border-top:1px solid #eef2f7;
    font-size:12px;
    color:#aab4be;
    text-align:center;
  }
</style>
</head>
<body>
<div class="wrapper">
  <div class="card">
    <div class="header">
      <span class="emoji">🎉</span>
      <h1>It's a Lunch Match, ${recipient.name.split(' ')[0]}!</h1>
    </div>
    <div class="body">
      <p style="font-size:15px;color:#3a4a5a;line-height:1.7;margin:0 0 8px">
        Great news - you've been matched for a Wolt Lunch Together! Time to make a new work friendship over food.
      </p>

      <div class="match-box">
        <div class="label">Your Lunch Buddy</div>
        <div class="name">${match.name}</div>
        <div class="email">${match.email}</div>
      </div>

      <p style="font-size:14px;color:#3a4a5a;margin:0 0 20px">
        <strong>Your move:</strong> reach out to <strong>${match.name.split(' ')[0]}</strong> on Slack or email and find a time that works for you both. Aim for this week or next!
      </p>

      <div class="steps">
        <div class="step">
          <div class="icon">📅</div>
          <div class="text">
            <strong>Agree on a time</strong>
            Block 45-60 min. Lunchtime obviously works, but a coffee break is great too.
          </div>
        </div>
        <div class="step">
          <div class="icon">🍕</div>
          <div class="text">
            <strong>Pick a spot (or order in!)</strong>
            Head to the Wolt app, pick a restaurant you both like, and try something new. Go crazy.
          </div>
        </div>
        <div class="step">
          <div class="icon">💬</div>
          <div class="text">
            <strong>Things to talk about</strong>
            What you're working on lately. How you ended up at Wolt. Best place you've eaten recently. Something you're excited about outside of work.
          </div>
        </div>
        <div class="step">
          <div class="icon">🌱</div>
          <div class="text">
            <strong>One good question to ask</strong>
            "What's something you wish more people at Wolt knew about your work?" - you'll be surprised by the answers.
          </div>
        </div>
      </div>

      <div class="selfie-box">
        <div class="big">📸</div>
        <p><strong>Don't forget the selfie!</strong><br/>Take a photo together and share it in #lets-lunch-together on Slack. We want to see everyone's lunch adventures!</p>
      </div>

      <p style="font-size:13px;color:#aab4be;margin:0;text-align:center">
        Can't make it happen? No worries - just reply to this email and we'll re-match you next round.
      </p>
    </div>
    <div class="footer">
      Wolt People Team · Let's Lunch Together 🍱<br/>
      This is an automated message from the Wolt Lunch Matcher.
    </div>
  </div>
</div>
</body>
</html>
  `;

  await transporter.sendMail({
    from: `"Wolt Lunch Together 🍱" <${process.env.EMAIL_USER}>`,
    to: recipient.email,
    subject,
    html,
  });
}

// ─── Start server ──────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Lunch Matcher backend running on port ${PORT}`));
