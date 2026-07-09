# AeroBrowse: Autonomous Browser Agent

AeroBrowse is a state-of-the-art, autonomous AI browser agent application that can perform real-world browsing tasks with minimal human intervention. Featuring a premium **FastAPI backend** and a gorgeous **Vite + React frontend**, AeroBrowse displays real-time browser action logs, cognitive thoughts, and live picture-in-picture screenshot streams.

---

## 🚀 Key Features

* **Visual Live Streaming**: Watch the agent browse in real time with base64 screenshots streamed over WebSockets.
* **Cognitive Mind Panel**: Peek into the agent's brain! See its **thinking process**, **evaluation of the previous step**, **next sub-goals**, and **active operations**.
* **Action Logs Console**: A styled retro-modern terminal that prints system logs, warnings, and custom action commands as they occur.
* **Extracted Results Tab**: Renders final structured answers, summaries, or data tables in clean markdown layout.
* **Hybrid Demo/Simulation Mode**: If no Google Gemini API key is configured, AeroBrowse triggers a high-fidelity deterministic browser mode using Playwright. It actually navigates the browser, draws highlighted overlays on live web elements, scrapes real page content, and streams it back to the dashboard, ensuring a fully operational presentation out of the box.
* **Real Agent Mode**: Input your Gemini API key in the panel, choose a model (Gemini 1.5 Flash/Pro), and let the LLM execute tasks dynamically.

---

## 🛠️ Tech Stack

* **Backend**: Python, FastAPI, Playwright, `browser-use` framework, `langchain-google-genai`, WebSockets.
* **Frontend**: React (v19), Vite, Vanilla CSS.

---

## 📂 Project Structure

```text
CBIT-1/
├── backend/
│   ├── app.py             # FastAPI WebSocket and REST server
│   ├── agent_runner.py    # Wraps the LLM browser-use Agent
│   ├── demo_runner.py     # High-fidelity live browser demo script
│   └── requirements.txt   # Python dependency sheet
└── frontend/
    ├── src/
    │   ├── App.jsx        # Main React dashboard layout & WebSockets
    │   └── index.css      # Core Vanilla CSS design system (glassmorphic)
    ├── package.json       # React dependencies
    └── vite.config.js     # Vite configuration
```

---

## ⚙️ Local Setup Guide

### Prerequisites
* Python 3.11 or higher
* Node.js v18 or higher

### 1. Backend Installation & Run
Navigate to the `backend/` directory in your terminal and execute:

```bash
# Create a virtual environment
python3 -m venv venv
source venv/bin/activate

# Install requirements
pip install -r requirements.txt

# Install Playwright browser binaries
playwright install chromium

# Start the FastAPI server
python app.py
```
The backend server will launch at **`http://localhost:8000`**.

### 2. Frontend Installation & Run
Open a new terminal window, navigate to the `frontend/` directory, and execute:

```bash
# Install Node modules
npm install

# Run the React dev server
npm run dev
```
The frontend dashboard will launch at **`http://localhost:5174`** (or `http://localhost:5173`).

---

## 🤖 Running Tasks

1. Open **`http://localhost:5174`** in your browser.
2. If you have a Google Gemini API Key, paste it into the **Gemini API Key** field in the Config Panel.
3. Select a pre-loaded template from the **Task Templates** card:
   * **Hacker News Top Stories**: Navigates, highlights, and prints the top 5 articles in a structured markdown table.
   * **Wikipedia Summary**: Searches Wikipedia for a query and summarizes the entry.
   * **Ebay Product Search**: Searches eBay and compares prices of mechanical keyboards.
4. Click **Run Browser Agent** and watch the logs, mind process, and browser screens update dynamically!
