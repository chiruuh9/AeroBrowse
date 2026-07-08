import os
import asyncio
import logging
from typing import Callable, Awaitable, Dict, Any
from browser_use import Agent, Browser
from browser_use.browser.views import BrowserStateSummary
from browser_use.agent.views import AgentOutput
from langchain_google_genai import ChatGoogleGenerativeAI

logger = logging.getLogger("agent_runner")

async def run_browser_agent(
    task: str,
    api_key: str,
    model_name: str = "gemini-2.5-flash",
    headless: bool = True,
    max_steps: int = 25,
    on_update: Callable[[Dict[str, Any]], Awaitable[None]] = None
) -> Dict[str, Any]:
    """
    Runs the browser-use Agent with the specified parameters,
    streaming step-by-step updates back to the caller via on_update callback.
    """
    # Fallback to env var if api_key is empty
    if not api_key:
        api_key = os.getenv("GEMINI_API_KEY", "")
    
    if not api_key:
        raise ValueError("Gemini API key is required to run the agent.")

    # Configure Gemini model
    llm = ChatGoogleGenerativeAI(
        model=model_name,
        google_api_key=api_key,
        temperature=0.0
    )

    # Configure browser
    browser = Browser(headless=headless, disable_security=True)

    async def step_callback(state: BrowserStateSummary, model_output: AgentOutput, step_count: int):
        if on_update:
            # Construct standard action logs
            actions_list = []
            if model_output.action:
                for action in model_output.action:
                    # action is a Pydantic model containing the custom action details
                    action_dict = action.model_dump()
                    # Flatten/beautify for front-end presentation
                    action_name = list(action_dict.keys())[0] if action_dict else "unknown"
                    action_args = action_dict[action_name] if action_name in action_dict else {}
                    actions_list.append({
                        "name": action_name,
                        "args": action_args
                    })

            payload = {
                "type": "step_update",
                "step": step_count,
                "thinking": model_output.thinking,
                "evaluation": model_output.evaluation_previous_goal,
                "next_goal": model_output.next_goal,
                "actions": actions_list,
                "url": state.url if state else "",
                "title": state.title if state else "",
                # state.screenshot is a base64 encoded string
                "screenshot": state.screenshot if state and state.screenshot else None,
            }
            await on_update(payload)

    # Initialize Agent
    agent = Agent(
        task=task,
        llm=llm,
        browser=browser,
        register_new_step_callback=step_callback,
        use_vision=True
    )

    try:
        # Run agent
        history = await agent.run(max_steps=max_steps)
        final_result = history.final_result()
        
        result_payload = {
            "type": "completed",
            "final_result": final_result,
            "total_steps": len(history.history) if history else 0,
            "success": history.is_done() if history else True
        }
        
        if on_update:
            await on_update(result_payload)
            
        return result_payload
    except Exception as e:
        logger.exception("Error executing agent task")
        error_payload = {
            "type": "error",
            "error": str(e)
        }
        if on_update:
            await on_update(error_payload)
        raise e
    finally:
        # Ensure browser is closed properly
        try:
            await browser.close()
        except Exception:
            pass
