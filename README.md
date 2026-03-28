# CampusEyes 👁️
### AI-powered campus navigation companion for blind and visually impaired students

CampusEyes combines GPS outdoor routing, AI vision scanning, and a 
community hazard network to give blind students the independence to 
navigate any campus — outdoors, indoors, and everywhere in between.

Built at HackUSF 2026 in 24 hours.

---

## The Problem
7.6 million Americans are visually impaired. On a college campus, 
something as simple as finding a classroom requires either memorizing 
every route or depending on someone else every single day. Existing 
tools describe what they see — none of them navigate, warn proactively, 
remember your campus, or connect you with other blind students.

CampusEyes does all four.

---

## Features

### 🗺️ GPS Navigation
Turn-by-turn audio directions from anywhere to anywhere on campus.
Automatically detects arrival and hands off to AI vision indoors.

### 👁️ Contextual AI Scanning
Single tap captures your surroundings. Ask follow-up questions 
naturally by voice. No rescan needed.

### 🚨 Proactive Hazard Detection
Passively monitors surroundings while you walk. Warns you before 
you reach an obstacle — not after.

### 👥 Community Hazard Network
When one user reports a hazard, every CampusEyes user nearby 
gets warned instantly. Blind students helping blind students.

### 🆘 Panic Button
Completely lost? One tap scans your surroundings, identifies 
the nearest landmark, and restarts your route.

### 📖 Read Mode
Point at any sign, door, or label — reads it aloud instantly.

### 🔍 Identify Mode
Point at any object and ask what it is.

---

## Tech Stack

- **Frontend:** React
- **GPS Routing:** Google Maps API
- **Vision AI:** Gemini 1.5 Flash
- **Voice Input/Output:** Web Speech API
- **Community Hazards:** Supabase
- **Hosting:** Vercel

---

## Getting Started

### Prerequisites
- Node.js
- Google Maps API key
- Gemini API key
- Supabase project URL and anon key

### Installation

git clone https://github.com/yourusername/campuseyes.git
cd campuseyes
npm install

### Environment Variables
Create a .env file in the root directory:

REACT_APP_GEMINI_API_KEY=your_gemini_api_key
REACT_APP_GOOGLE_MAPS_API_KEY=your_google_maps_api_key
REACT_APP_SUPABASE_URL=your_supabase_url
REACT_APP_SUPABASE_ANON_KEY=your_supabase_anon_key

### Run Locally

npm start

---

## How It Works

1. User opens CampusEyes and says their destination
2. GPS routing gives turn-by-turn audio directions outdoors
3. On arrival, app prompts a contextual scan of the entrance
4. AI describes surroundings — user asks follow-up questions by voice
5. Community hazards from nearby users surface automatically
6. Spatial memory stores every route for faster guidance next visit

---

## Impact

- 7.6 million Americans have a visual disability
- 1 in 4 Americans has some form of disability
- No existing tool combines outdoor GPS, indoor AI vision, 
  and community safety in one place
- Works on any smartphone — no hardware, no download, no barriers

---

## Built By
[Your Team Names]
University of South Florida — HackUSF 2026

---

## License
MIT
```

---

## One-Line Repo Description
*(Goes in the GitHub repo description field at the top)*

> `AI-powered campus navigation companion combining GPS routing, vision scanning, and community hazard reporting for blind and visually impaired students.`

---

## Topics/Tags to Add on GitHub
```
accessibility, blind, navigation, ai, gemini, react, 
campus, hackathon, vision-ai, web-speech-api, supabase