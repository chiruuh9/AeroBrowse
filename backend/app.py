import os
import json
import asyncio
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Dict, List, Any
from datetime import datetime

from agent_runner import run_browser_agent
from demo_runner import run_demo_agent

app = FastAPI(title="AeroBrowse Backend API")

# Allow CORS for development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

HISTORY_FILE = "task_history.json"
history_cache = []

# Load history
if os.path.exists(HISTORY_FILE):
    try:
        with open(HISTORY_FILE, "r") as f:
            history_cache = json.load(f)
    except Exception:
        history_cache = []

def save_history():
    try:
        with open(HISTORY_FILE, "w") as f:
            json.dump(history_cache, f, indent=2)
    except Exception as e:
        print(f"Error saving history: {e}")

class ConfigCheck(BaseModel):
    api_key: str

@app.post("/api/config-check")
async def config_check(config: ConfigCheck):
    # Verify API key simple format check
    if not config.api_key and not os.getenv("GEMINI_API_KEY"):
        raise HTTPException(status_code=400, detail="Gemini API Key is not set")
    return {"status": "ok", "message": "Gemini API key is configured"}

@app.get("/api/history")
async def get_history():
    return history_cache

@app.post("/api/history/clear")
async def clear_history():
    global history_cache
    history_cache = []
    save_history()
    return {"status": "ok"}

# Store active tasks for cancellation
active_tasks: Dict[WebSocket, asyncio.Task] = {}

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    print("WebSocket client connected")
    
    try:
        while True:
            data = await websocket.receive_text()
            message = json.loads(data)
            
            action = message.get("action")
            if action == "start":
                # If there's already a running task for this socket, cancel it
                if websocket in active_tasks:
                    active_tasks[websocket].cancel()
                
                task_prompt = message.get("task")
                api_key = message.get("api_key", "")
                model_name = message.get("model_name", "gemini-1.5-flash")
                headless = message.get("headless", True)
                max_steps = message.get("max_steps", 25)
                
                # Create history entry
                history_entry = {
                    "id": datetime.now().strftime("%Y%m%d_%H%M%S"),
                    "task": task_prompt,
                    "model": model_name,
                    "status": "running",
                    "started_at": datetime.now().isoformat(),
                    "steps": [],
                    "final_result": None
                }
                history_cache.insert(0, history_entry)
                save_history()
                
                async def ws_update_callback(payload):
                    # Save step info to history (omit screenshot from JSON history file to save space)
                    if payload["type"] == "step_update":
                        history_entry["steps"].append({
                            "step": payload["step"],
                            "thinking": payload["thinking"],
                            "evaluation": payload["evaluation"],
                            "next_goal": payload["next_goal"],
                            "actions": payload["actions"],
                            "url": payload["url"],
                            "title": payload["title"]
                        })
                        save_history()
                    elif payload["type"] == "completed":
                        history_entry["status"] = "success" if payload.get("success", True) else "failed"
                        history_entry["final_result"] = payload.get("final_result")
                        save_history()
                    elif payload["type"] == "error":
                        history_entry["status"] = "error"
                        history_entry["final_result"] = f"Error: {payload.get('error')}"
                        save_history()
                        
                    # Forward to websocket
                    try:
                        await websocket.send_json(payload)
                    except Exception:
                        pass
                
                async def agent_task():
                    try:
                        has_env_key = bool(os.getenv("GEMINI_API_KEY"))
                        has_provided_key = bool(api_key.strip())
                        
                        if not has_env_key and not has_provided_key:
                            print("Running in DEMO MODE (no API key detected)")
                            await websocket.send_json({
                                "type": "status",
                                "message": "No Gemini API key detected. Running in Hybrid Demo Mode (live browser + highlights)..."
                            })
                            await run_demo_agent(
                                task=task_prompt,
                                headless=headless,
                                max_steps=max_steps,
                                on_update=ws_update_callback
                            )
                        else:
                            print("Running in REAL AGENT MODE")
                            await run_browser_agent(
                                task=task_prompt,
                                api_key=api_key,
                                model_name=model_name,
                                headless=headless,
                                max_steps=max_steps,
                                on_update=ws_update_callback
                            )
                    except asyncio.CancelledError:
                        print("Agent task cancelled by user request")
                        history_entry["status"] = "cancelled"
                        save_history()
                        try:
                            await websocket.send_json({"type": "cancelled", "message": "Task cancelled by user"})
                        except Exception:
                            pass
                    except Exception as e:
                        print(f"Agent task failed: {e}")
                        history_entry["status"] = "error"
                        save_history()
                    finally:
                        if websocket in active_tasks:
                            del active_tasks[websocket]
                
                # Start agent in background
                run_task = asyncio.create_task(agent_task())
                active_tasks[websocket] = run_task
                
            elif action == "stop":
                if websocket in active_tasks:
                    print("Stopping running agent task...")
                    active_tasks[websocket].cancel()
                    await websocket.send_json({"type": "status", "message": "Cancelling task..."})
                else:
                    await websocket.send_json({"type": "status", "message": "No running task to stop"})
                    
    except WebSocketDisconnect:
        print("WebSocket client disconnected")
        # Cancel any running task for this socket
        if websocket in active_tasks:
            active_tasks[websocket].cancel()
            del active_tasks[websocket]
    except Exception as e:
        print(f"WebSocket error: {e}")
        if websocket in active_tasks:
            active_tasks[websocket].cancel()
            del active_tasks[websocket]

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app:app", host="0.0.0.0", port=8000, reload=True)
