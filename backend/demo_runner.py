import asyncio
import base64
import logging
from datetime import datetime
from typing import Callable, Awaitable, Dict, Any
from playwright.async_api import async_playwright

logger = logging.getLogger("demo_runner")

async def run_demo_agent(
    task: str,
    headless: bool = True,
    max_steps: int = 15,
    on_update: Callable[[Dict[str, Any]], Awaitable[None]] = None
) -> Dict[str, Any]:
    """
    Automates Playwright deterministically for demo purposes, capturing real screenshots,
    highlighting targets, extracting live web data, and streaming state over WebSockets.
    """
    task_lower = task.lower()
    
    # Determine target workflow
    if "news.ycombinator.com" in task_lower or "hacker news" in task_lower:
        return await run_hacker_news_demo(headless, on_update)
    elif "wikipedia" in task_lower:
        return await run_wikipedia_demo(headless, task, on_update)
    elif "ebay" in task_lower:
        return await run_ebay_demo(headless, task, on_update)
    else:
        return await run_generic_demo(headless, task, on_update)

async def capture_state(page, step: int, thinking: str, evaluation: str, next_goal: str, actions: list, on_update):
    """Helper to take a screenshot and trigger callback."""
    screenshot_bytes = await page.screenshot(type="png")
    screenshot_b64 = base64.b64encode(screenshot_bytes).decode("utf-8")
    
    payload = {
        "type": "step_update",
        "step": step,
        "thinking": thinking,
        "evaluation": evaluation,
        "next_goal": next_goal,
        "actions": actions,
        "url": page.url,
        "title": await page.title(),
        "screenshot": screenshot_b64
    }
    if on_update:
        await on_update(payload)
    await asyncio.sleep(2.5)  # Let user visually follow the steps in the dashboard

async def run_hacker_news_demo(headless, on_update):
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=headless)
        page = await browser.new_page()
        await page.set_viewport_size({"width": 1280, "height": 800})
        
        # Step 1: Navigate
        await page.goto("https://news.ycombinator.com")
        await capture_state(
            page, 1,
            thinking="The user wants the top articles and scores from Hacker News. I will navigate to news.ycombinator.com first.",
            evaluation="Browser initialized.",
            next_goal="Navigate to Hacker News homepage",
            actions=[{"name": "navigate", "args": {"url": "https://news.ycombinator.com"}}],
            on_update=on_update
        )
        
        # Step 2: Highlight top 5 and extract
        # Draw magenta boxes around the first 5 news titles and scores
        await page.evaluate("""() => {
            const rows = document.querySelectorAll('tr.athing');
            const subtexts = document.querySelectorAll('td.subtext');
            for(let i=0; i<5; i++) {
                if(rows[i]) rows[i].style.border = '2px solid #ff00ff';
                if(subtexts[i]) subtexts[i].style.border = '2px dashed #00ffff';
            }
        }""")
        
        # Extract live data
        stories = await page.evaluate("""() => {
            const items = [];
            const titles = document.querySelectorAll('tr.athing');
            for(let i=0; i<Math.min(5, titles.length); i++) {
                const titleLine = titles[i].querySelector('span.titleline a');
                const title = titleLine ? titleLine.innerText : 'Unknown';
                
                const subtext = titles[i].nextElementSibling;
                const scoreEl = subtext ? subtext.querySelector('span.score') : null;
                const score = scoreEl ? scoreEl.innerText : '0 points';
                
                items.push({rank: i+1, title, score});
            }
            return items;
        }""")
        
        await capture_state(
            page, 2,
            thinking="I have loaded the page. I see the titles and scores. I am highlighting the top 5 articles and extracting their information.",
            evaluation="Hacker News homepage loaded. Articles visible.",
            next_goal="Extract text, titles, and score values",
            actions=[{"name": "extract_content", "args": {"elements": "top-5-rows"}}],
            on_update=on_update
        )
        
        # Step 3: Format and Complete
        result_md = "Here are the top 5 stories extracted from Hacker News:\n\n"
        result_md += "| Rank | Title | Points |\n| :--- | :--- | :--- |\n"
        for s in stories:
            result_md += f"| {s['rank']} | {s['title']} | {s['score']} |\n"
            
        await browser.close()
        
        res = {
            "type": "completed",
            "success": True,
            "final_result": result_md,
            "total_steps": 3
        }
        if on_update:
            await on_update(res)
        return res

async def run_wikipedia_demo(headless, task, on_update):
    # Extract query term if possible, default 'Antigravity'
    query = "Antigravity"
    if "search for" in task.lower():
        parts = task.lower().split("search for")
        if len(parts) > 1:
            query = parts[1].replace("'", "").replace('"', "").strip().split(" ")[0].capitalize()

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=headless)
        page = await browser.new_page()
        await page.set_viewport_size({"width": 1280, "height": 800})
        
        # Step 1: Navigate
        await page.goto("https://www.wikipedia.org")
        await page.fill("#searchInput", query)
        await page.evaluate("""() => {
            document.querySelector('#searchInput').style.border = '3px solid #ff00ff';
        }""")
        
        await capture_state(
            page, 1,
            thinking=f"The user wants information about '{query}' from Wikipedia. I will open wikipedia.org and prepare to search.",
            evaluation="Browser initialized, Wikipedia homepage loaded.",
            next_goal=f"Enter search query '{query}' into search field",
            actions=[{"name": "fill_input", "args": {"selector": "#searchInput", "value": query}}],
            on_update=on_update
        )
        
        # Step 2: Search and Load Article
        await page.click("button[type='submit']")
        await page.wait_for_load_state("networkidle")
        
        # Draw overlay on first paragraph
        await page.evaluate("""() => {
            const firstPara = document.querySelector('div.mw-content-ltr p');
            if (firstPara) {
                firstPara.style.border = '2px dashed #00ff00';
                firstPara.style.padding = '8px';
                firstPara.style.background = 'rgba(0, 255, 0, 0.05)';
            }
        }""")
        
        # Scrape introduction
        summary = await page.evaluate("""() => {
            const p = document.querySelector('div.mw-content-ltr p');
            return p ? p.innerText : 'Could not locate summary.';
        }""")
        
        await capture_state(
            page, 2,
            thinking=f"The Wikipedia page for '{query}' loaded. I will locate the introduction section and extract the first paragraph.",
            evaluation=f"Search completed. Article '{query}' loaded.",
            next_goal="Locate article introduction",
            actions=[{"name": "read_paragraph", "args": {"selector": "p"}}],
            on_update=on_update
        )
        
        await browser.close()
        
        result_text = f"**Wikipedia Summary for '{query}':**\n\n{summary}"
        res = {
            "type": "completed",
            "success": True,
            "final_result": result_text,
            "total_steps": 3
        }
        if on_update:
            await on_update(res)
        return res

async def run_ebay_demo(headless, task, on_update):
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=headless)
        page = await browser.new_page()
        await page.set_viewport_size({"width": 1280, "height": 800})
        
        # Step 1: Navigate to eBay
        await page.goto("https://www.ebay.com")
        await page.fill("#gh-ac", "refurbished mechanical keyboard")
        await page.evaluate("""() => {
            document.querySelector('#gh-ac').style.border = '3px solid #ff00ff';
        }""")
        
        await capture_state(
            page, 1,
            thinking="The user wants to search for mechanical keyboards on eBay. I am navigating to eBay and entering the search terms.",
            evaluation="eBay homepage loaded.",
            next_goal="Search for refurbished mechanical keyboard",
            actions=[{"name": "fill_input", "args": {"selector": "#gh-ac", "value": "refurbished mechanical keyboard"}}],
            on_update=on_update
        )
        
        # Step 2: Click Search and wait for results
        await page.click("#gh-btn")
        await page.wait_for_load_state("networkidle")
        
        # Highlight top 3 listings
        await page.evaluate("""() => {
            const listings = document.querySelectorAll('.s-item__info');
            for(let i=1; i<=3; i++) { // index 0 is sometimes a placeholder/ad
                if(listings[i]) {
                    listings[i].style.border = '2px solid #00f5d4';
                    listings[i].style.padding = '4px';
                }
            }
        }""")
        
        # Scrape listings
        listings = await page.evaluate("""() => {
            const results = [];
            const titles = document.querySelectorAll('.s-item__title span[role="heading"]');
            const prices = document.querySelectorAll('.s-item__price');
            for(let i=1; i<=3; i++) {
                if(titles[i] && prices[i]) {
                    results.push({
                        title: titles[i].innerText,
                        price: prices[i].innerText
                    });
                }
            }
            return results;
        }""")
        
        await capture_state(
            page, 2,
            thinking="The search results have loaded. I am extracting the titles and prices of the top three items listed on the page.",
            evaluation="Listing results visible.",
            next_goal="Extract listing titles and price structures",
            actions=[{"name": "extract_listings", "args": {"count": 3}}],
            on_update=on_update
        )
        
        await browser.close()
        
        result_md = "### Top Listings on eBay:\n\n"
        for idx, item in enumerate(listings):
            result_md += f"**{idx+1}. {item['title']}**\n- **Price:** {item['price']}\n\n"
            
        res = {
            "type": "completed",
            "success": True,
            "final_result": result_md,
            "total_steps": 3
        }
        if on_update:
            await on_update(res)
        return res

async def run_generic_demo(headless, task, on_update):
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=headless)
        page = await browser.new_page()
        await page.set_viewport_size({"width": 1280, "height": 800})
        
        # Step 1: Navigate to google as default fallback
        await page.goto("https://www.google.com")
        await capture_state(
            page, 1,
            thinking=f"Executing fallback workflow. The user wants to: '{task}'. I will start by querying google.com.",
            evaluation="Browser initialized, default gateway google.com loaded.",
            next_goal="Search for task on Google",
            actions=[{"name": "navigate", "args": {"url": "https://www.google.com"}}],
            on_update=on_update
        )
        
        # Step 2: Formulate query and search
        await page.fill("textarea[name='q']", task)
        await page.press("textarea[name='q']", "Enter")
        await page.wait_for_load_state("networkidle")
        
        await capture_state(
            page, 2,
            thinking="Search results loaded. I am reviewing the top results to extract relevant answers for the user's task.",
            evaluation="Google search completed.",
            next_goal="Read and extract information",
            actions=[{"name": "read_results", "args": {}}],
            on_update=on_update
        )
        
        await browser.close()
        
        result_text = f"Demo execution finished for task: '{task}'\n\nGoogle search results loaded and reviewed. Simulated output generated successfully."
        res = {
            "type": "completed",
            "success": True,
            "final_result": result_text,
            "total_steps": 3
        }
        if on_update:
            await on_update(res)
        return res
