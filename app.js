import express from 'express';
import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();
const app = express();
app.use(express.json());

const SCOPES = [
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/meetings'
];
const TOKEN_PATH = path.join(process.cwd(), 'token.json');

let credentials;
try {
  credentials = JSON.parse(fs.readFileSync('credentials.json'));
} catch (error) {
  console.error('Error: Missing or invalid credentials.json file.', error);
  process.exit(1);
}
const { client_secret, client_id, redirect_uris } = credentials.web;
const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

// Redirect user to Google's OAuth 2.0 authentication page
app.get('/auth', (req, res) => {
  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
  });
  res.redirect(authUrl);
});

app.get('/oauth2callback', async (req, res) => {
    try {
      const { code } = req.query;
      if (!code) {
        return res.status(400).json({ error: 'Missing authorization code' });
      }
  
      const { tokens } = await oAuth2Client.getToken(code);
      fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens));
  
      console.log('Authentication successful. Token stored.');
      res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3000/dashboard'}?auth=success`);
    } catch (error) {
      console.error('Error during authentication:', error);
      res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3000/dashboard'}?auth=failure`);
    }
  });
  

// Middleware to load authentication token
const authenticate = async () => {
  try {
    const token = JSON.parse(fs.readFileSync(TOKEN_PATH));
    oAuth2Client.setCredentials(token);
  } catch (err) {
    console.error('Token not found. Authenticate first via /auth');
  }
};

// Fetch user information
app.get('/api/user-info', async (req, res) => {
  try {
    await authenticate();
    const oauth2 = google.oauth2({ version: 'v2', auth: oAuth2Client });
    const userInfo = await oauth2.userinfo.get();
    res.json(userInfo.data);
  } catch (error) {
    console.error('Error fetching user info:', error);
    res.status(500).json({ error: 'Failed to fetch user info' });
  }
});

// Create a Google Meet meeting
app.post('/api/create-meeting', async (req, res) => {
  try {
    await authenticate();
    const calendar = google.calendar({ version: 'v3', auth: oAuth2Client });

    const { title, startTime, endTime, timeZone, attendees } = req.body;

    const event = {
      summary: title,
      start: { dateTime: startTime, timeZone },
      end: { dateTime: endTime, timeZone },
      attendees: attendees.map(email => ({ email })),
      conferenceData: {
        createRequest: {
          requestId: `meet-${Date.now()}`,
          conferenceSolutionKey: { type: 'hangoutsMeet' },
        },
      },
    };

    const response = await calendar.events.insert({
      calendarId: 'primary',
      resource: event,
      conferenceDataVersion: 1,
    });

    res.json({ meetLink: response.data.hangoutLink });
  } catch (error) {
    console.error('Error creating meeting:', error);
    res.status(500).json({ error: 'Failed to create meeting' });
  }
});

// Fetch conference records (Google Meet sessions)
app.get('/api/conference-records', async (req, res) => {
  try {
    await authenticate();
    const meet = google.meet({ version: 'v1', auth: oAuth2Client });

    const response = await meet.conferenceRecords.list();
    res.json({ conferenceRecords: response.data.conferenceRecords });
  } catch (error) {
    console.error('Error fetching conference records:', error);
    res.status(500).json({ error: 'Failed to fetch conference records' });
  }
});

// Fetch transcripts for a specific conference
app.get('/api/conference-records/:conferenceId/transcripts', async (req, res) => {
  try {
    await authenticate();
    const meet = google.meet({ version: 'v1', auth: oAuth2Client });
    const { conferenceId } = req.params;

    const response = await meet.conferenceRecords.transcripts.list({
      parent: `conferences/${conferenceId}`,
    });

    res.json({ transcripts: response.data.transcripts });
  } catch (error) {
    console.error('Error fetching transcripts:', error);
    res.status(500).json({ error: 'Failed to fetch transcripts' });
  }
});

// Fetch transcript entries for a specific transcript
app.get('/api/conference-records/:conferenceId/transcripts/:transcriptId/entries', async (req, res) => {
  try {
    await authenticate();
    const meet = google.meet({ version: 'v1', auth: oAuth2Client });
    const { conferenceId, transcriptId } = req.params;

    const response = await meet.conferenceRecords.transcripts.entries.list({
      parent: `conferences/${conferenceId}/transcripts/${transcriptId}`,
    });

    res.json({ entries: response.data.entries });
  } catch (error) {
    console.error('Error fetching transcript entries:', error);
    res.status(500).json({ error: 'Failed to fetch transcript entries' });
  }
});

const PORT = process.env.PORT || 5001;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
