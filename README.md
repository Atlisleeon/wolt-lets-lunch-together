# 🍱 Wolt Lunch Matcher

An internal tool that matches Wolt employees for lunch meetups, sends match emails, and logs everything to Google Sheets.

---

## Project Structure

```
lunch-matcher/
├── frontend/
│   ├── index.html     - Employee registration page
│   └── admin.html     - HR admin dashboard
├── backend/
│   ├── server.js      - Express API
│   ├── package.json
│   └── .env.example   - Copy to .env and fill in
└── README.md
```

---

## Setup Guide

### Step 1 - Google Sheets DB

1. Go to [Google Sheets](https://sheets.google.com) and create a new spreadsheet
2. Name it `Lunch Matcher DB` (or anything you like)
3. Copy the Sheet ID from the URL: `https://docs.google.com/spreadsheets/d/[THIS_IS_THE_ID]/edit`
4. The backend will auto-create tabs: `Participants`, `Matches`, `Rounds`

### Step 2 - Google Service Account

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a new project (or use existing)
3. Enable **Google Sheets API**
4. Go to IAM & Admin > Service Accounts > Create Service Account
5. Name it `lunch-matcher`
6. Click the service account > Keys > Add Key > JSON
7. Download the JSON file
8. Copy the `client_email` value into `GOOGLE_SERVICE_ACCOUNT_EMAIL` in `.env`
9. Copy the `private_key` value into `GOOGLE_PRIVATE_KEY` in `.env`
10. Share your Google Sheet with the service account email (Editor access)

### Step 3 - Gmail App Password

1. Go to your Google Account > Security
2. Enable 2-Step Verification (required)
3. Go to App Passwords > Generate
4. Select "Mail" > device "Other" > name it "Lunch Matcher"
5. Copy the 16-char password into `EMAIL_APP_PASSWORD` in `.env`
6. Put the sender email in `EMAIL_USER`

### Step 4 - Run locally

```bash
cd backend
cp .env.example .env
# fill in all values in .env

npm install
npm run dev
```

Backend runs at `http://localhost:3000`

### Step 5 - Set the API URL in frontend

In both `frontend/index.html` and `frontend/admin.html`, find:

```javascript
const API_BASE = window.API_BASE || 'https://YOUR_BACKEND_URL';
```

Replace `YOUR_BACKEND_URL` with your deployed backend URL (see deployment section).
For local testing: `http://localhost:3000`

---

## Deployment

### Deploy Backend to Railway (recommended - free tier available)

1. Push to GitHub (see below)
2. Go to [railway.app](https://railway.app) and create account
3. New Project > Deploy from GitHub repo > select your repo
4. Set Root Directory to `backend`
5. Add all env variables from `.env` in Railway's Variables tab
6. Railway will give you a URL like `https://lunch-matcher-production.up.railway.app`
7. Update `API_BASE` in both frontend files with this URL

### Deploy Frontend to GitHub Pages

1. Push the whole repo to GitHub
2. Go to repo Settings > Pages
3. Source: `Deploy from a branch`
4. Branch: `main` / folder: `/frontend` (or `/root` and put frontend files at root)
5. Your app will be at `https://[your-username].github.io/[repo-name]/`

> The admin page (`/admin.html`) is protected by password. Change `ADMIN_PASSWORD` in `admin.html` or better - move auth to the backend.

### Alternative: Deploy frontend to Vercel/Netlify

Both are free and even easier. Just connect your GitHub repo.

---

## GitHub Setup

```bash
# In the lunch-matcher/ root folder:
git init
git add .
git commit -m "Initial commit - Wolt Lunch Matcher"

# Create repo on GitHub (github.com/new), then:
git remote add origin https://github.com/YOUR_USERNAME/lunch-matcher.git
git branch -M main
git push -u origin main
```

---

## API Reference

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| POST | `/register` | None | Register a participant |
| GET | `/count` | None | Get participant count |
| GET | `/admin/participants` | Admin key | List all participants |
| POST | `/admin/match` | Admin key | Run matching + send emails |
| DELETE | `/admin/clear` | Admin key | Clear all participants |

Admin key is sent as `x-admin-key` header, set by `ADMIN_KEY` env var.

---

## Customization

### Change the email content
Edit `sendMatchEmail()` in `server.js`. The HTML template is self-contained.

### Change the lunch instructions
The 4 steps (agree on time, pick a spot, what to talk about, selfie) are all in the email template in `server.js`. Fully editable.

### Change admin password
Set `ADMIN_KEY` in your `.env` on the backend, and update `ADMIN_PASSWORD` in `admin.html`.

### Add domain restriction (e.g. @wolt.com only)
In `server.js`, in the `/register` route, add:
```javascript
if (!email.endsWith('@wolt.com')) {
  return res.status(400).json({ error: 'Please use your Wolt work email' });
}
```

---

## How It Works

1. HR shares the `index.html` URL with the team
2. Employees register with their work email + Slack name
3. HR opens `admin.html`, monitors registrations
4. When enough people are in, HR clicks "Match & Send Emails"
5. Backend shuffles all unmatched participants, pairs them up
6. Each person gets a personalized email with their match's name + contact
7. All data (participants, matches, rounds) is logged in Google Sheets
8. If odd number of participants - one person is left over (flagged in response, handle manually)

---

Made with ❤️ by the Wolt People team
