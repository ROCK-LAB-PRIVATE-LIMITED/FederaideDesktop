"""
FEDERaiDE Electron Native IPC Bridge Engine (Standard I/O Stream)
Communicates directly with the Electron Main process over stdin/stdout with JSON lines.
"""

import sys
import os
import json
import time
import uuid
import glob
import re
import secrets
import threading
from datetime import datetime
from pathlib import Path
from dataclasses import asdict

# --- RESOLVE PYTHON PACKAGE PATHS ---
import site
import glob
import subprocess

current_dir = os.path.dirname(os.path.abspath(__file__))
home = os.path.expanduser("~")

uv_tool_dirs = []

# Dynamic check via `uv tool dir`
try:
    uv_out = subprocess.check_output(["uv", "tool", "dir"], text=True, stderr=subprocess.DEVNULL).strip()
    if uv_out and os.path.isdir(uv_out):
        uv_tool_dirs.append(os.path.join(uv_out, "federaide"))
except Exception:
    pass

# Standard directory locations across Windows (%APPDATA% & %LOCALAPPDATA%), macOS, and Linux
uv_tool_dirs.extend([
    os.path.expandvars(r"%APPDATA%\uv\tools\federaide"),
    os.path.expandvars(r"%LOCALAPPDATA%\uv\tools\federaide"),
    os.path.join(home, "AppData", "Roaming", "uv", "tools", "federaide"),
    os.path.join(home, "AppData", "Local", "uv", "tools", "federaide"),
    os.path.join(home, ".local", "share", "uv", "tools", "federaide"),
])

for td in uv_tool_dirs:
    if os.path.isdir(td):
        sp_candidates = (
            glob.glob(os.path.join(td, "lib", "python*", "site-packages")) +
            glob.glob(os.path.join(td, "Lib", "site-packages")) +
            [os.path.join(td, "Lib", "site-packages"), os.path.join(td, "lib", "site-packages")]
        )
        for sp in sp_candidates:
            if os.path.isdir(sp):
                site.addsitedir(sp)
                for pkg_name in ("federate", "federaide"):
                    pkg_sub = os.path.join(sp, pkg_name)
                    if os.path.isdir(pkg_sub) and pkg_sub not in sys.path:
                        sys.path.insert(0, pkg_sub)

# 2. If 'federate' package is now importable, push its module folder to sys.path
try:
    import federate
    fed_dir = os.path.dirname(os.path.abspath(federate.__file__))
    if fed_dir not in sys.path:
        sys.path.insert(0, fed_dir)
except Exception:
    pass

# 3. Local source tree candidates (for local development)
candidate_paths = [
    current_dir,
    os.path.abspath(os.path.join(current_dir, "src", "federate")),
    os.path.abspath(os.path.join(current_dir, "..", "src", "federate")),
    os.path.abspath(os.path.join(current_dir, "..", "..", "src", "federate")),
    os.path.abspath(os.path.join(current_dir, "federate")),
]
for p in candidate_paths:
    if os.path.isdir(p) and p not in sys.path:
        sys.path.insert(0, p)

try:
    import toolbox
    import agent_core

    # --- MONKEY PATCH RE.SUB TO PREVENT CORE FROM STRIPPING BASE64 PAYLOADS ---
    _orig_sub = re.sub

    class BypassStr(str):
        def __len__(self): return 10
        def __add__(self, other): return BypassStr(super().__add__(other))

    def _patched_sub(pattern, repl, string, count=0, flags=0):
        if pattern == r'\[ImageBase64:\s*[^\]]+\]' and repl == '[ImageBase64: <data_transmitted>]':
            return BypassStr(string)
        if pattern == r'data:image/[a-zA-Z]+;base64,[A-Za-z0-9+/=\s]{20,}' and repl == '<base64_data_omitted>':
            return BypassStr(string)
        return _orig_sub(pattern, repl, string, count, flags)

    re.sub = _patched_sub
    # --------------------------------------------------------------------------

    from orchestration import AgentManager, SessionManager, AgentConfig, HistoryMessage, ScheduleManager
    from commands import handle_ampersand_commands, process_shell_command, process_slash_command, SLASH_COMMANDS
except Exception as e:
    import traceback
    err_payload = {
        "type": "backend_missing",
        "error": f"Backend Error: {e}",
        "instructions": f"Traceback:\n{traceback.format_exc()}"
    }
    sys.stdout.write(json.dumps(err_payload) + "\n")
    sys.stdout.flush()
    sys.exit(3)

def get_safe_starting_dir() -> str:
    if sys.platform == "win32":
        p = Path.home() / "FederateWorkspace"
    elif sys.platform == "darwin":
        p = Path.home() / "Documents" / "FederateWorkspace"
    else:
        p = Path.home() / "FederateWorkspace"
    p.mkdir(parents=True, exist_ok=True)
    return str(p.absolute())

class MockDirTree:
    def __init__(self, view):
        self._view = view
        self.value = ""
        self.text = ""
        self.display = True
        class Styles:
            display = "block"
        self.styles = Styles()

    @property
    def path(self):
        return self._view.workspace_dir

    @path.setter
    def path(self, new_p):
        self._view.set_directory(str(new_p))

    def reload(self): pass
    def scroll_end(self, animate=False): pass
    def update(self, *args, **kwargs): pass
    def clear(self): pass
    def write(self, *args, **kwargs): pass
    def focus(self): pass
    def query(self, *args, **kwargs): return []

class AppMock:
    def __init__(self, view):
        self._view = view
        self.mock_dir_tree = MockDirTree(view)
        self.mock_widget = self.mock_dir_tree
        self.run_configs = {
            "python": {"executable": sys.executable or "python3", "flags": "-u \"{file}\""}
        }

    def push_screen(self, screen, callback=None):
        if callable(callback):
            try: callback(None)
            except Exception: pass

    def pop_screen(self):
        pass

    def call_from_thread(self, func, *args, **kwargs):
        try: return func(*args, **kwargs)
        except Exception: return None

    def call_after_refresh(self, func, *args, **kwargs):
        try: return func(*args, **kwargs)
        except Exception: return None

    def notify(self, message, *args, **kwargs):
        if hasattr(self._view, "log_to_ui"):
            self._view.log_to_ui(f"[bold cyan]Notice:[/] {message}")

    def query_one(self, selector, *args, **kwargs):
        sel = str(selector).strip().lower()
        if "dir_tree" in sel or "directorytree" in sel or "#dir_tree" in sel:
            return self.mock_dir_tree
        if "ai_agent_view" in sel or "aiagentview" in sel or "#ai_agent_view" in sel:
            return self._view
        return self._view

    def query(self, selector, *args, **kwargs):
        return []

class HeadlessAgentView:
    def __init__(self):
        self.workspace_dir = get_safe_starting_dir()
        try: os.chdir(self.workspace_dir)
        except Exception: pass

        self.app = AppMock(self)
        self.mock_widget = self.app.mock_dir_tree
        toolbox.CURRENT_APP = self.app
        toolbox.CURRENT_AGENT_VIEW = self
        toolbox.CURRENT_LOG_CB = self.log_to_ui

        self.agent_manager = AgentManager()
        self.session_manager = SessionManager()
        self.schedule_manager = ScheduleManager()
        self.telegram_manager = None
        self.current_telegram_chat_id = None
        self.last_screenshot_path = None

        # Background automated schedule timer
        threading.Thread(target=self._scheduler_loop, daemon=True).start()
        # Background X11 desktop display monitor (opens noVNC in Electron when a GUI window spawns)
        threading.Thread(target=self._gui_window_monitor_loop, daemon=True).start()

        default_name = self.agent_manager.get_default_agent_name()
        self.active_agent = self.agent_manager.get_agent(default_name) or list(self.agent_manager.agents.values())[0]

        self.agent_mode = "PLAN"
        self._running_agents = set()
        self.turn_queue = []
        self.paused_queue = []
        self.turn_lock = threading.Lock()
        self.current_batch_id = 0
        self.current_tokens = 0
        self.pdf_dpi = 150

        self.pending_tool_confirmations = {}
        self.tool_confirmation_results = {}
        self.is_authenticated = True
        self.session_token = "ELECTRON_IPC_ACTIVE"

    def query_one(self, selector, *args, **kwargs):
        return self.app.query_one(selector, *args, **kwargs)

    def send_to_electron(self, payload):
        """Streams JSON directly to Electron stdout"""
        try:
            line = json.dumps(payload)
            sys.stdout.write(line + "\n")
            sys.stdout.flush()
        except Exception:
            pass

    def log_to_ui(self, msg, is_markdown=False):
        self.send_to_electron({"type": "log", "content": str(msg), "is_markdown": is_markdown})

    def write_message_block(self, header_markup, content, color, is_markdown=True, silent=False):
        content_str = str(content)
        if "[Attached Image:" in content_str:
            matches = re.finditer(r'\[Attached Image:\s*(.*?)\]', content_str)
            for match in matches:
                filepath = match.group(1).strip()
                try:
                    import mimetypes, base64
                    from toolbox import get_safe_path
                    resolved_path, _ = get_safe_path(filepath)
                    if os.path.exists(resolved_path) and not resolved_path.lower().endswith(".pdf"):
                        mime = mimetypes.guess_type(resolved_path)[0] or "image/png"
                        with open(resolved_path, "rb") as f:
                            b64 = base64.b64encode(f.read()).decode('utf-8')
                        content_str = content_str.replace(match.group(0), f"[ImageBase64: data:{mime};base64,{b64}]")
                except Exception:
                    pass
        self.send_to_electron({"type": "message_block", "header": header_markup, "content": content_str, "color": color, "is_markdown": is_markdown, "silent": silent})

    def mount_ai_message_box(self, agent_name, agent_color):
        self.send_to_electron({"type": "mount_ai_box", "agent_name": agent_name, "color": agent_color})

    def update_ai_message(self, display_text):
        self.send_to_electron({"type": "update_ai_box", "content": display_text})

    def render_tool_result_box(self, owner_name, color, summary, silent=False):
        summary = str(summary)
        if "[Attached Image:" in summary:
            matches = re.finditer(r'\[Attached Image:\s*(.*?)\]', summary)
            for match in matches:
                filepath = match.group(1).strip()
                try:
                    import mimetypes, base64
                    from toolbox import get_safe_path
                    resolved_path, _ = get_safe_path(filepath)
                    if os.path.exists(resolved_path) and not resolved_path.lower().endswith(".pdf"):
                        mime = mimetypes.guess_type(resolved_path)[0] or "image/png"
                        with open(resolved_path, "rb") as f:
                            b64 = base64.b64encode(f.read()).decode('utf-8')
                        summary = summary.replace(match.group(0), f"[ImageBase64: data:{mime};base64,{b64}]")
                except Exception:
                    pass
        self.send_to_electron({"type": "tool_result", "agent": owner_name, "color": color, "summary": summary, "silent": silent})

    def render_tool_error_box(self, owner_name, color, summary):
        self.send_to_electron({"type": "tool_error", "agent": owner_name, "color": color, "summary": summary})

    def _toggle_spinner(self, show, agent_name="Agent", agent_color="#00FFFF"):
        self.send_to_electron({"type": "spinner", "show": show, "agent": agent_name, "color": agent_color})

    def render_latex_to_unicode_ext(self, text):
        return text

    def update_status_bar(self):
        self.send_to_electron({
            "type": "status_bar", "mode": self.agent_mode, "agent": self.active_agent.name,
            "agent_color": self.active_agent.color, "tokens": self.current_tokens,
            "model": self.active_agent.model, "cwd": self.workspace_dir
        })

    def update_tokens(self):
        try:
            history = self.session_manager.active_sessions.get(self.active_agent.name, [])
            text = "".join((m.content or "") + "".join(str(out.get("content", "")) for out in (m.tool_outputs or [])) for m in history)
            self.current_tokens = len(text) // 4
        except Exception:
            self.current_tokens = 0
        self.update_status_bar()

    def toggle_plan_mode(self):
        ARM_MODES = ["PLAN", "INTERMEDIATE", "EXECUTE"]
        idx = ARM_MODES.index(self.agent_mode) if self.agent_mode in ARM_MODES else 0
        self.agent_mode = ARM_MODES[(idx + 1) % len(ARM_MODES)]
        self.update_status_bar()
        self.log_to_ui(f"System security permission mode: [bold]{self.agent_mode}[/bold]")

    def get_executor(self, agent_config):
        return agent_core.get_executor_core(self, agent_config)

    def _compute_diff(self, tool_name: str, arguments: dict) -> str | None:
        try:
            import difflib
            from toolbox import get_safe_path
            
            fp = arguments.get("filepath") or arguments.get("file_path") or arguments.get("path") or ""
            if not fp:
                return None
            safe_path, display_path = get_safe_path(fp)
            
            orig_content = ""
            if os.path.exists(safe_path):
                with open(safe_path, "r", encoding="utf-8", errors="replace") as f:
                    orig_content = f.read()

            new_content = None
            search = arguments.get("search") or arguments.get("old_str") or arguments.get("old_content")
            replace = arguments.get("replace") or arguments.get("new_str")
            new_content_arg = arguments.get("new_content") or arguments.get("content")
            start_line = arguments.get("start_line")
            end_line = arguments.get("end_line")

            # 1. Search & Replace mode
            if search is not None and replace is not None and search in orig_content:
                new_content = orig_content.replace(search, replace, 1)

            # 2. Line-range edit mode (start_line & end_line)
            elif start_line is not None and end_line is not None and (new_content_arg is not None or replace is not None):
                raw_rep = new_content_arg if new_content_arg is not None else replace
                # Strip hallucinated line number prefixes like "1: ..." from read_file output
                clean_lines = [re.sub(r'^\s*\d+:\s?', '', l) for l in str(raw_rep).splitlines()]
                clean_rep = "\n".join(clean_lines)

                orig_lines = orig_content.splitlines(keepends=True)
                s_idx = max(0, int(start_line) - 1)
                e_idx = max(s_idx, min(len(orig_lines), int(end_line)))

                rep_lines = [l + "\n" for l in clean_rep.splitlines()] if clean_rep else []
                new_lines = orig_lines[:s_idx] + rep_lines + orig_lines[e_idx:]
                new_content = "".join(new_lines)

            # 3. Direct full-content overwrite / save_file mode
            elif new_content_arg is not None:
                new_content = str(new_content_arg)

            if new_content is not None and new_content != orig_content:
                from_label = f"a/{display_path}" if os.path.exists(safe_path) else "/dev/null"
                orig_lines = [l + "\n" for l in orig_content.splitlines()]
                new_lines = [l + "\n" for l in new_content.splitlines()]
                diff_lines = list(difflib.unified_diff(
                    orig_lines,
                    new_lines,
                    fromfile=from_label,
                    tofile=f"b/{display_path}",
                    n=3
                ))
                if diff_lines:
                    return "".join(diff_lines)
        except Exception:
            pass
        return None

    def confirm_tool_execution(self, tool_name, arguments, agent_name="Agent"):
        call_id = str(uuid.uuid4())
        self.pending_tool_confirmations[call_id] = threading.Event()
        self.tool_confirmation_results[call_id] = False

        diff_text = None
        if tool_name in ("edit_file", "save_file"):
            diff_text = self._compute_diff(tool_name, arguments)

        if tool_name in ("take_screenshot", "click_at_current_location", "move_cursor_absolute", "move_cursor_relative", "send_scroll", "inject_keyboard_input", "visual_computer_operation"):
            self.send_to_electron({"type": "open_novnc", "url": "http://127.0.0.1:6080/vnc.html?autoconnect=true&resize=remote"})

        self.send_to_electron({
            "type": "confirm_tool",
            "call_id": call_id,
            "tool_name": tool_name,
            "arguments": arguments,
            "agent_name": agent_name,
            "diff": diff_text
        })

        while not self.pending_tool_confirmations[call_id].is_set():
            if toolbox.ABORT_EVENT.is_set(): return False
            time.sleep(0.1)

        return bool(self.tool_confirmation_results.get(call_id, False))

    def request_clarification(self, options=None, agent_name="Agent"):
        call_id = str(uuid.uuid4())
        self.pending_tool_confirmations[call_id] = threading.Event()
        self.tool_confirmation_results[call_id] = ""

        self.send_to_electron({"type": "confirm_tool", "call_id": call_id, "tool_name": "get_user_clarification", "agent_name": agent_name, "arguments": {"options": options or []}})

        while not self.pending_tool_confirmations[call_id].is_set():
            if toolbox.ABORT_EVENT.is_set(): return ""
            time.sleep(0.1)

        res = self.tool_confirmation_results.get(call_id, "")
        if isinstance(res, bool): return "yes" if res else "no"
        return str(res)

    def mount_progress(self, tasks):
        self.send_to_electron({"type": "mount_progress", "tasks": tasks})

    def update_progress(self, task_name, percent, log_text):
        self.send_to_electron({"type": "update_progress", "task": task_name, "percent": percent, "log": log_text})

    def hide_progress(self):
        self.send_to_electron({"type": "hide_progress"})

    def is_onboarding_needed(self) -> bool:
        settings_path = os.path.join(self.agent_manager.agents_dir, "settings.json")
        is_pristine = not os.path.exists(settings_path)
        if is_pristine:
            return True
        if len(self.agent_manager.agents) <= 1:
            key = self.active_agent.get_api_key()
            if not key or key == "":
                return True
        return False

    def ensure_chatgpt_auth_for_agent(self, agent):
        try:
            from chatgpt_auth import is_chatgpt_oauth_agent, has_valid_chatgpt_token
            if is_chatgpt_oauth_agent(agent): return has_valid_chatgpt_token()
        except Exception: pass
        return True

    def set_directory(self, new_dir: str):
        if os.path.exists(new_dir) and os.path.isdir(new_dir):
            self.workspace_dir = os.path.abspath(new_dir)
            try: os.chdir(self.workspace_dir)
            except Exception: pass
            self.update_status_bar()
            self.log_to_ui(f"[bold green]Workspace changed to:[/] {self.workspace_dir}")

    def select_agent(self, name: str) -> bool:
        agent = self.agent_manager.get_agent(name)
        if agent:
            self.active_agent = agent
            self.update_status_bar()
            self.send_to_electron({"type": "agent_selected", "name": agent.name, "color": agent.color, "model": agent.model})
            return True
        return False

    def action_abort(self):
        toolbox.ABORT_EVENT.set()
        if hasattr(self, "current_batch_id"): self.session_manager.abort_batch(self.current_batch_id)
        toolbox.nuke_all_threads()
        self._running_agents.clear()
        self.log_to_ui("[bold red]Operation Aborted by User.[/bold red]")

    def _get_last_scheduled(self, task, now):
        import calendar
        from datetime import timedelta
        try:
            task_date = datetime.strptime(getattr(task, "date_str", ""), "%Y-%m-%d") if getattr(task, "date_str", "") else now
            th, tm = map(int, task.time_str.split(":"))
            anchor = datetime(task_date.year, task_date.month, task_date.day, th, tm)
        except Exception:
            return None

        if anchor > now:
            return None

        repeat_mode = getattr(task, "repeat", "daily")
        candidate = anchor
        while True:
            if repeat_mode == "daily":
                nxt = candidate + timedelta(days=1)
            elif repeat_mode == "weekly":
                nxt = candidate + timedelta(weeks=1)
            elif repeat_mode == "monthly":
                month = candidate.month
                year = candidate.year + (month // 12)
                month = (month % 12) + 1
                max_day = calendar.monthrange(year, month)[1]
                nxt = datetime(year, month, min(task_date.day, max_day), th, tm)
            elif repeat_mode == "annually":
                nxt = datetime(candidate.year + 1, task_date.month, task_date.day, th, tm)
            else:
                nxt = candidate + timedelta(days=1)

            if nxt > now:
                break
            candidate = nxt
        return candidate

    def _gui_window_monitor_loop(self):
        import shutil
        last_state = False
        while True:
            time.sleep(0.5)
            try:
                disp = os.environ.get("DISPLAY")
                if disp and shutil.which("xwininfo"):
                    out = subprocess.check_output(
                        ["xwininfo", "-display", disp, "-root", "-tree"],
                        stderr=subprocess.DEVNULL,
                        timeout=0.4,
                        text=True
                    )
                    # Exclude structural/invisible elements like 'FocusProxy' and '1x1'/'10x10' utility windows
                    has_window = any(
                        '"' in line and ' 1x1+' not in line and ' 10x10+' not in line and not any(ign in line.lower() for ign in ['"fluxbox"', '"awesome"', '"wibar"', '"desktop"', '"root window"', '"x11vnc"', '"tigervnc"', '"focusproxy"'])
                        for line in out.splitlines()
                    )
                    if has_window and not last_state:
                        self.send_to_electron({"type": "open_novnc", "url": "http://127.0.0.1:6080/vnc.html?autoconnect=true&resize=scale&quality=9&compression=0"})
                    last_state = has_window
            except Exception:
                pass

    def _scheduler_loop(self):
        while True:
            time.sleep(15)
            try:
                now = datetime.now()
                for task in self.schedule_manager.tasks:
                    if not getattr(task, "is_active", True): continue
                    if getattr(task, "snooze_until", 0.0) > time.time(): continue

                    last_scheduled = self._get_last_scheduled(task, now)
                    if last_scheduled:
                        sched_str = last_scheduled.strftime("%Y-%m-%d %H:%M")
                        if getattr(task, "last_run_date", "") != sched_str:
                            if self._running_agents:
                                continue

                            task.last_run_date = sched_str
                            self.schedule_manager.save()
                            self.action_clear_all_contexts()

                            agent = self.agent_manager.get_agent(task.agent_name) or self.active_agent
                            self.log_to_ui(f"[bold yellow]Executing Scheduled Routine for {agent.name}...[/bold yellow]\n[dim]{task.prompt}[/dim]")
                            full_prompt = f"@{agent.name} [Automated Scheduled Task]:\n{task.prompt}"
                            self.process_input(full_prompt)
            except Exception:
                pass

    def handle_schedule_command(self, prompt: str):
        parts = prompt.strip().split()
        if len(parts) == 1 or parts[1].lower() in ("list", "show"):
            if not self.schedule_manager.tasks:
                self.log_to_ui("[bold yellow]No scheduled task routines configured.[/bold yellow]")
                return
            out = "[bold cyan]Scheduled Task Routines:[/bold cyan]\n"
            for t in self.schedule_manager.tasks:
                out += f"- [bold]{t.id}[/bold] ({t.agent_name} @ {t.time_str} [{getattr(t, 'repeat', 'daily').title()}]): {t.prompt[:60]}...\n"
            self.log_to_ui(out)
            return

        if parts[1].lower() in ("del", "delete", "rm", "remove") and len(parts) >= 3:
            t_id = parts[2]
            self.schedule_manager.delete_task(t_id)
            self.log_to_ui(f"[bold green]Deleted scheduled task '{t_id}'.[/bold green]")
            return

        if parts[1].lower() in ("clear", "clear_all"):
            self.schedule_manager.tasks = []
            self.schedule_manager.save()
            self.log_to_ui("[bold green]All scheduled tasks cleared.[/bold green]")
            return

        try:
            agent_candidate = parts[1]
            time_candidate = parts[2]

            if re.match(r"^(?:[01]\d|2[0-3]):[0-5]\d$", agent_candidate):
                agent_name = self.active_agent.name
                time_str = agent_candidate
                idx = 2
            else:
                agent = self.agent_manager.get_agent(agent_candidate)
                agent_name = agent.name if agent else self.active_agent.name
                time_str = time_candidate
                idx = 3

            date_str = ""
            if idx < len(parts) and re.match(r"^\d{4}-\d{2}-\d{2}$", parts[idx]):
                date_str = parts[idx]
                idx += 1

            repeat = "daily"
            if idx < len(parts) and parts[idx].lower() in ("daily", "weekly", "monthly", "annually"):
                repeat = parts[idx].lower()
                idx += 1

            task_prompt = " ".join(parts[idx:]).strip()
            if not task_prompt:
                self.log_to_ui("[bold red]Please provide a task prompt for the schedule.[/bold red]")
                return

            self.schedule_manager.add_task(agent_name, time_str, task_prompt, date_str=date_str, repeat=repeat)
            self.log_to_ui(f"[bold green]✓ Scheduled task routine added for {agent_name} at {time_str} ({repeat.title()})![/bold green]\n[dim]{task_prompt}[/dim]")
            self.get_schedules_data()
        except Exception as e:
            self.log_to_ui(f"[bold red]Failed to save schedule:[/bold red] {e}")

    def action_clear_all_contexts(self):
        self.action_abort()
        self.session_manager.clear_all_contexts()
        default_name = self.agent_manager.get_default_agent_name()
        if default_name:
            self.select_agent(default_name)
        self.agent_mode = "PLAN"
        self.current_tokens = 0
        self.send_to_electron({"type": "clear_chat"})
        self.log_to_ui("[bold yellow]ALL CONTEXTS CLEARED. Fresh multiagent session started.[/bold yellow]")
        self.update_status_bar()

    def run_agent_task(self, agent, prompt, override_thread_id=None, batch_id=0):
        threading.Thread(target=agent_core.run_agent_task_core, args=(self, agent, prompt, override_thread_id, batch_id), daemon=True).start()

    def process_input(self, prompt):
        if not prompt.strip(): return
        if prompt.startswith("!"):
            cmd = prompt[1:].strip()
            out = process_shell_command(cmd, self)
            self.log_to_ui(f"[bold red]Shell:[/bold red] {cmd}\n{out}")
            return
        if prompt.startswith("/"):
            if prompt.startswith("/schedule"):
                self.handle_schedule_command(prompt)
                return
            process_slash_command(prompt, self)
            return

        is_interrupt = False
        if self._running_agents:
            self.action_abort()
            is_interrupt = True

        self.current_batch_id += 1
        batch_id = self.current_batch_id

        all_agents_list = list(self.agent_manager.agents.values())
        clean_prompt = prompt
        if is_interrupt: clean_prompt = f"the User interrupted to say this: {clean_prompt}"

        seq_mentions = self.agent_manager.get_mentions(clean_prompt)
        par_mentions = self.agent_manager.get_parallel_mentions(clean_prompt)
        acting_agents = []

        if clean_prompt.strip().lower().startswith("@team"):
            clean_prompt = clean_prompt.strip()[5:].strip()
            for a in all_agents_list:
                self.session_manager.init_agent_session(a, all_agents_list)
                self.session_manager.join_conversation(self.active_agent.name, a, all_agents_list)
            acting_agents = all_agents_list
        elif clean_prompt.strip().lower().startswith("@room"):
            clean_prompt = clean_prompt.strip()[5:].strip()
            for name in list(self.session_manager.active_sessions.keys()):
                a = self.agent_manager.get_agent(name)
                if a:
                    self.session_manager.join_conversation(self.active_agent.name, a, all_agents_list)
                    acting_agents.append(a)
        else:
            if seq_mentions:
                target_agents = [self.agent_manager.get_agent(n) for n in seq_mentions if self.agent_manager.get_agent(n)]
                if target_agents:
                    if par_mentions:
                        with self.turn_lock: self.turn_queue = target_agents
                    else:
                        first_agent = target_agents[0]
                        with self.turn_lock: self.turn_queue = target_agents[1:]
                        acting_agents.append(first_agent)
            elif not par_mentions:
                acting_agents.append(self.active_agent)
            for name in par_mentions:
                p_agent = self.agent_manager.get_agent(name)
                if p_agent and p_agent not in acting_agents: acting_agents.append(p_agent)

        if not acting_agents: acting_agents.append(self.active_agent)

        for a in acting_agents:
            self.session_manager.init_agent_session(a, all_agents_list)
            self.session_manager.join_conversation(self.active_agent.name, a, all_agents_list)

        time_stamp = f"[Time: {datetime.now().strftime('%H:%M')}]\n"
        processed_prompt = time_stamp + handle_ampersand_commands(clean_prompt, self)
        disp_prompt = handle_ampersand_commands(clean_prompt, self)

        user_cfg = toolbox.load_global_settings()
        u_name = user_cfg.get("user_name", "User")
        u_color = user_cfg.get("user_color", "#dda0dd")

        self.write_message_block(f"[bold {u_color}]{u_name}:[/bold {u_color}]", disp_prompt, u_color, is_markdown=True)
        self.session_manager.broadcast_message(u_name, processed_prompt, is_ai=False)
        self.update_tokens()

        toolbox.ABORT_EVENT.clear()
        for agent in acting_agents: self.run_agent_task(agent, processed_prompt, batch_id=batch_id)

    def get_suggestions(self, value: str):
        if not value: return
        if value.startswith("/"):
            matches = [{"match": cmd, "desc": "Slash Command"} for cmd in SLASH_COMMANDS if cmd.startswith(value)]
            self.send_to_electron({"type": "suggestions", "mode": "command", "matches": matches})
            return
        last_amp = value.rfind("&")
        if last_amp != -1:
            partial_path = value[last_amp + 1:].replace(r"\ ", " ")
            base_dir = self.workspace_dir
            search_pattern = os.path.join(base_dir, partial_path + "*")
            files = glob.glob(search_pattern)
            files.sort()
            matches = []
            for f in files[:8]:
                rel = os.path.relpath(f, base_dir).replace("\\", "/")
                if os.path.isdir(f): rel += "/"
                desc = "Directory" if os.path.isdir(f) else f"File ({os.path.getsize(f)/1024:.1f} KB)"
                matches.append({"match": rel, "desc": desc})
            self.send_to_electron({"type": "suggestions", "mode": "file", "prefix": value[:last_amp + 1], "matches": matches})
            return
        last_at = value.rfind("@")
        if last_at != -1:
            partial_name = value[last_at + 1:].lower()
            agent_names = list(self.agent_manager.agents.keys()) + ["team", "room"]
            matches = []
            for name in agent_names:
                if name.lower().startswith(partial_name):
                    agent = self.agent_manager.get_agent(name)
                    desc = agent.backstory[:50] + "..." if agent else "Broadcast mention"
                    matches.append({"match": name, "desc": desc})
            self.send_to_electron({"type": "suggestions", "mode": "agent", "prefix": value[:last_at + 1], "matches": matches})
            return
        self.send_to_electron({"type": "suggestions", "matches": []})

    def get_agent_data(self, name=None):
        agent = self.agent_manager.get_agent(name) or self.active_agent if (name and isinstance(name, str)) else self.active_agent
        data = asdict(agent)
        data["api_key"] = agent.get_api_key()
        data["backup_api_key"] = agent.get_backup_api_key()
        all_tools = ["list_files", "search_web", "perform_research", "render_pdf", "manage_agenda", "read_file", "fetch_url", "save_file", "edit_file", "dispatch_coding_subagent", "run_terminal_command", "visual_computer_operation", "send_file_to_telegram"]
        self.send_to_electron({"type": "agent_data", "data": data, "all_tools": all_tools, "all_agent_names": list(self.agent_manager.agents.keys())})

    def save_agent_data(self, fields, is_new=False, old_name=None):
        def _verify_and_save():
            if not fields or not isinstance(fields, dict):
                self.send_to_electron({"type": "agent_save_status", "status": "failed", "error": "Invalid field data."})
                return

            name = fields.get("name", "").strip()
            if not name:
                self.send_to_electron({"type": "agent_save_status", "status": "failed", "error": "Agent name cannot be empty."})
                return

            fields_copy = dict(fields)
            api_key = fields_copy.pop("api_key", "")
            backup_key = fields_copy.pop("backup_api_key", "")
            
            try:
                config = AgentConfig(**fields_copy)
            except Exception as ce:
                self.send_to_electron({"type": "agent_save_status", "status": "failed", "error": f"Config error: {ce}"})
                return

            try:
                import keyring
                safe_key_name = name.lower().replace(" ", "_")
                if api_key:
                    keyring.set_password("Federate", f"agent_key_{safe_key_name}", api_key)
                    os.environ[f"AGENT_KEY_{name.upper().replace(' ', '_')}"] = api_key
                if backup_key:
                    keyring.set_password("Federate", f"agent_backup_key_{safe_key_name}", backup_key)
                    os.environ[f"AGENT_BACKUP_KEY_{name.upper().replace(' ', '_')}"] = backup_key
            except Exception:
                pass

            self.log_to_ui(f"[dim yellow]Verifying credentials & translating backstory for '{name}'...[/dim yellow]")

            translated, error_msg = agent_core.translate_backstory(config)
            if error_msg:
                self.log_to_ui(f"[bold red]Agent verification failed for '{name}':[/bold red] {error_msg}")
                self.send_to_electron({"type": "agent_save_status", "status": "failed", "error": str(error_msg), "name": name})
                return

            try:
                cache_path = toolbox.get_storage_path("agents", "translated_backstories.json")
                cache = {}
                if os.path.exists(cache_path):
                    try:
                        with open(cache_path, "r", encoding="utf-8") as f: cache = json.load(f)
                    except Exception: pass
                cache[name] = {
                    "original": config.backstory,
                    "translated": translated
                }
                os.makedirs(os.path.dirname(cache_path), exist_ok=True)
                with open(cache_path, "w", encoding="utf-8") as f:
                    json.dump(cache, f, indent=4)
            except Exception:
                pass

            if not is_new and old_name and old_name != name and old_name in self.agent_manager.agents:
                self.agent_manager.delete_agent(old_name)

            self.agent_manager.save_agent(config)
            current_default = self.agent_manager.get_default_agent_name()
            if not current_default or (old_name and old_name == current_default) or len(self.agent_manager.agents) <= 1:
                self.agent_manager.set_default_agent_name(name)
            self.select_agent(name)
            self.log_to_ui(f"[bold green]Agent '{name}' verified & backstory saved successfully.[/bold green]\n[dim]{translated}[/dim]")
            
            self.send_to_electron({
                "type": "init",
                "session_token": self.session_token,
                "active_agent": self.active_agent.name,
                "default_agent": self.agent_manager.get_default_agent_name(),
                "agents": [{"name": a.name, "color": a.color, "model": a.model} for a in self.agent_manager.agents.values()],
                "needs_onboarding": self.is_onboarding_needed()
            })
            self.send_to_electron({"type": "agent_save_status", "status": "success", "name": name})

        threading.Thread(target=_verify_and_save, daemon=True).start()

    def delete_agent(self, name):
        if len(self.agent_manager.agents) <= 1:
            self.log_to_ui("[bold red]Cannot delete the only remaining agent.[/bold red]")
            return
        self.agent_manager.delete_agent(name)
        next_name = list(self.agent_manager.agents.keys())[0]
        self.select_agent(next_name)
        self.send_to_electron({
            "type": "init",
            "session_token": self.session_token,
            "active_agent": self.active_agent.name,
            "default_agent": self.agent_manager.get_default_agent_name(),
            "agents": [{"name": a.name, "color": a.color, "model": a.model} for a in self.agent_manager.agents.values()],
            "needs_onboarding": self.is_onboarding_needed()
        })

    def run_chatgpt_oauth(self):
        try:
            import chatgpt_auth, base64, hashlib, urllib.parse, http.server
            self.log_to_ui("[dim cyan]Opening browser for ChatGPT OAuth sign-in...[/dim cyan]")
            self.send_to_electron({"type": "chatgpt_oauth_status", "status": "waiting", "message": "Opening browser for sign-in..."})
            host, port, callback_path = chatgpt_auth.DEFAULT_REDIRECT_HOST, chatgpt_auth.DEFAULT_REDIRECT_PORT, chatgpt_auth.DEFAULT_REDIRECT_PATH
            redirect_uri = f"http://{host}:{port}{callback_path}"
            state = secrets.token_urlsafe(32)
            verifier = base64.urlsafe_b64encode(secrets.token_bytes(64)).rstrip(b"=").decode("ascii")
            challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode("ascii")).digest()).rstrip(b"=").decode("ascii")
            params = {
                "client_id": chatgpt_auth.CHATGPT_CLIENT_ID,
                "response_type": "code",
                "redirect_uri": redirect_uri,
                "scope": chatgpt_auth.DEFAULT_SCOPE,
                "code_challenge": challenge,
                "code_challenge_method": "S256",
                "state": state,
                "prompt": "consent"
            }
            authorize_url = f"{chatgpt_auth.CHATGPT_AUTHORIZE_URL}?{urllib.parse.urlencode(params)}"
            class Handler(chatgpt_auth._CallbackHandler):
                server_result = {}
                callback_path = chatgpt_auth.DEFAULT_REDIRECT_PATH
            Handler.authorize_url = authorize_url
            try:
                server = http.server.HTTPServer((host, port), Handler)
                server.timeout = 1.0
            except Exception:
                self.log_to_ui("[bold red]Port 1455 occupied. Could not start OAuth callback server.[/bold red]")
                self.send_to_electron({"type": "chatgpt_oauth_status", "status": "failed", "message": "Port 1455 occupied. Could not start callback server."})
                return
            self.send_to_electron({"type": "open_external_url", "url": authorize_url})
            deadline = time.monotonic() + 300.0
            result = {}
            while time.monotonic() < deadline:
                server.handle_request()
                if Handler.server_result.get("code") or Handler.server_result.get("error"):
                    result = dict(Handler.server_result)
                    break
            server.server_close()
            code = result.get("code")
            if code:
                import httpx
                tok_resp = httpx.post(chatgpt_auth.CHATGPT_TOKEN_URL, data={"grant_type": "authorization_code", "code": code, "redirect_uri": redirect_uri, "client_id": chatgpt_auth.CHATGPT_CLIENT_ID, "code_verifier": verifier}, headers={"Accept": "application/json", "User-Agent": chatgpt_auth.HTTP_HEADERS["User-Agent"]}, timeout=30.0)
                tok_resp.raise_for_status()
                token = chatgpt_auth._token_from_response(tok_resp.json())
                provider = chatgpt_auth._FileChatGPTOAuthTokenProvider()
                provider.save(token)
                plan = (token.plan_type or "Active").title()
                self.log_to_ui(f"[bold green]ChatGPT Subscription ({plan}) authorized successfully! Token saved.[/bold green]")
                self.send_to_electron({"type": "chatgpt_oauth_status", "status": "success", "message": f"Connected ({plan})!"})
            else:
                err = result.get("error_description") or result.get("error") or "Timed out or cancelled."
                self.log_to_ui(f"[bold red]ChatGPT OAuth failed:[/bold red] {err}")
                self.send_to_electron({"type": "chatgpt_oauth_status", "status": "failed", "message": str(err)})
        except Exception as e:
            self.log_to_ui(f"[bold red]ChatGPT OAuth error:[/bold red] {e}")
            self.send_to_electron({"type": "chatgpt_oauth_status", "status": "failed", "message": str(e)})

    def get_global_settings(self):
        settings = toolbox.load_global_settings()
        self.send_to_electron({"type": "global_settings_data", "data": settings})

    def save_global_settings(self, settings):
        toolbox.save_global_settings(settings)
        self.log_to_ui("[bold green]Global settings saved.[/bold green]")

    def get_sessions_list(self):
        sessions_dir = toolbox.get_storage_path("sessions")
        if not os.path.exists(sessions_dir):
            self.send_to_electron({"type": "sessions_list_data", "sessions": []})
            return

        files = sorted(glob.glob(os.path.join(sessions_dir, "*.json")), key=os.path.getmtime, reverse=True)
        name_map = agent_core.get_session_name_map()
        
        seen_sessions = {}
        for f in files:
            base = os.path.basename(f).replace(".json", "")
            parts = base.split("_")
            if len(parts) < 2:
                continue
            sess_id = f"{parts[0]}_{parts[1]}"
            
            # 1. Only include sessions that have a real, friendly name
            friendly_name = name_map.get(sess_id)
            if not friendly_name or friendly_name.startswith("sess_"):
                continue

            # 2. Filter out empty sessions (must have actual dialogue beyond the system prompt)
            try:
                with open(f, "r", encoding="utf-8") as sf:
                    data = json.load(sf)
                    if not isinstance(data, list) or len(data) <= 1:
                        continue
                    has_real_messages = any(isinstance(m, dict) and m.get("role") != "system" for m in data)
                    if not has_real_messages:
                        continue
            except Exception:
                continue

            # 3. Deduplicate multiple agent files for the same session
            if sess_id not in seen_sessions:
                seen_sessions[sess_id] = {
                    "path": f,
                    "name": friendly_name,
                    "id": sess_id,
                    "mtime": os.path.getmtime(f)
                }
            else:
                if self.active_agent and self.active_agent.name.lower() in base.lower():
                    seen_sessions[sess_id]["path"] = f

        results = sorted(seen_sessions.values(), key=lambda x: x["mtime"], reverse=True)
        self.send_to_electron({"type": "sessions_list_data", "sessions": results})

    def get_schedules_data(self):
        tasks_data = [asdict(t) for t in self.schedule_manager.tasks]
        self.send_to_electron({"type": "schedules_data", "tasks": tasks_data})

    def _clean_tool_summary(self, t_name: str, t_content: str) -> str:
        if t_name in ["search_web", "SearchWeb"]:
            return "[Search results successfully parsed and delivered to active agent context]"
        content_str = str(t_content or "")
        
        if "[Attached Image:" in content_str:
            matches = re.finditer(r'\[Attached Image:\s*(.*?)\]', content_str)
            for match in matches:
                filepath = match.group(1).strip()
                try:
                    import mimetypes, base64
                    from toolbox import get_safe_path
                    resolved_path, _ = get_safe_path(filepath)
                    if os.path.exists(resolved_path) and not resolved_path.lower().endswith(".pdf"):
                        mime = mimetypes.guess_type(resolved_path)[0] or "image/png"
                        with open(resolved_path, "rb") as f:
                            b64 = base64.b64encode(f.read()).decode('utf-8')
                        content_str = content_str.replace(match.group(0), f"[ImageBase64: data:{mime};base64,{b64}]")
                except Exception:
                    pass

        if len(content_str) > 500 and "[ImageBase64:" not in content_str:
            return content_str[:500] + '...'
        return content_str

    def load_session_file(self, filepath):
        if not os.path.exists(filepath): return
        try:
            base = os.path.basename(filepath).replace(".json", "")
            parts = base.split("_")
            if len(parts) < 2: return
            sess_id = f"{parts[0]}_{parts[1]}"
            owner_raw = "_".join(parts[2:]) if len(parts) >= 3 else parts[-1]
            matched_owner = self.agent_manager.get_agent(owner_raw) or self.agent_manager.get_agent(owner_raw.replace("_", " "))
            owner = matched_owner.name if matched_owner else owner_raw.replace("_", " ")

            # 1. Purge previous session state so old agents don't linger
            self.action_abort()
            self.session_manager.active_sessions.clear()
            with self.turn_lock:
                self.turn_queue.clear()
                self.paused_queue.clear()

            self.session_manager.current_session_id = sess_id

            # 2. Discover and load all agents belonging to this session on disk
            matching_files = glob.glob(os.path.join(self.session_manager.sessions_dir, f"{sess_id}_*.json"))
            if not matching_files:
                matching_files = [filepath]

            for sf in matching_files:
                sf_base = os.path.basename(sf).replace(".json", "")
                sf_parts = sf_base.split("_")
                sf_owner_raw = "_".join(sf_parts[2:]) if len(sf_parts) >= 3 else sf_parts[-1]
                sf_matched = self.agent_manager.get_agent(sf_owner_raw) or self.agent_manager.get_agent(sf_owner_raw.replace("_", " "))
                sf_agent_name = sf_matched.name if sf_matched else sf_owner_raw.replace("_", " ")

                try:
                    with open(sf, "r", encoding="utf-8") as f:
                        data = json.load(f)
                    valid_msgs = []
                    for m in data:
                        if isinstance(m, dict):
                            clean_m = {k: v for k, v in m.items() if k in HistoryMessage.__dataclass_fields__}
                            valid_msgs.append(HistoryMessage(**clean_m))
                    self.session_manager.active_sessions[sf_agent_name] = valid_msgs
                except Exception:
                    pass

            if owner not in self.session_manager.active_sessions and self.session_manager.active_sessions:
                owner = list(self.session_manager.active_sessions.keys())[0]

            self.select_agent(owner)

            user_cfg = toolbox.load_global_settings()
            u_name = user_cfg.get("user_name", "User")
            u_color = user_cfg.get("user_color", "#dda0dd")

            self.send_to_electron({"type": "clear_chat"})
            self.log_to_ui(f"[bold green]Restored Session: {sess_id} (agent: {owner})[/bold green]")
            self.update_status_bar()

            owner_history = self.session_manager.active_sessions.get(owner, [])
            for msg in owner_history:
                role = msg.role
                if role == "system": continue
                content = msg.content or ""

                if role == "ai":
                    owner_agent = self.agent_manager.get_agent(owner)
                    color = owner_agent.color if owner_agent else (self.active_agent.color or "#3ddbd9")
                    if content and content.strip():
                        self.write_message_block(f"[bold {color}]{owner}:[/bold {color}]", content, color, is_markdown=True, silent=True)

                    if msg.tool_calls:
                        for tc in msg.tool_calls:
                            tc_name = tc.get("name", "tool")
                            tc_args = str(tc.get("args", {}))
                            call_text = f"Calling Tool: {tc_name} with args: {tc_args}"
                            self.write_message_block(f"[bold {color}]{owner} (Tool Call):[/bold {color}]", call_text, color, is_markdown=False, silent=True)

                    if msg.tool_outputs:
                        for out in msg.tool_outputs:
                            t_name = out.get("name", "tool")
                            t_content = str(out.get("content", ""))
                            summary = self._clean_tool_summary(t_name, t_content)
                            self.render_tool_result_box(owner, color, summary, silent=True)

                elif role == "human":
                    intercom_match = re.search(r'<AGENT_INTERCOM sender="([^"]+)">([\s\S]*?)</AGENT_INTERCOM>', content)
                    tool_match = re.search(r'<AGENT_INTERCOM_TOOL_RESPONSE agent="([^"]+)" tool="([^"]+)"[^>]*>([\s\S]*?)</AGENT_INTERCOM_TOOL_RESPONSE>', content)

                    if intercom_match:
                        sender_label = intercom_match.group(1)
                        synced_agent = self.agent_manager.get_agent(sender_label)
                        color = synced_agent.color if synced_agent else "#3ddbd9"
                        msg_text = intercom_match.group(2).strip()
                        msg_text = re.sub(r'^\s*(?:\[(?:Time|Today\'s date)[^\]]*\]\s*)+', '', msg_text, flags=re.IGNORECASE).strip()
                        self.write_message_block(f"[bold {color}]{sender_label}:[/bold {color}]", msg_text, color, is_markdown=True, silent=True)
                    elif tool_match:
                        agent_name = tool_match.group(1)
                        tool_name = tool_match.group(2)
                        synced_agent = self.agent_manager.get_agent(agent_name)
                        color = synced_agent.color if synced_agent else "#3ddbd9"
                        tool_output_content = tool_match.group(3).strip()

                        args_match = re.search(r'- Arguments:\s*(.*?)(?:\n-|\n*$)', tool_output_content)
                        args_str = args_match.group(1).strip() if args_match else ""
                        if args_str and args_str != "None":
                            call_text = f"Calling Tool: {tool_name} with args: {args_str}"
                        else:
                            call_text = f"Calling Tool: {tool_name}"
                        self.write_message_block(f"[bold {color}]{agent_name} (Tool Call):[/bold {color}]", call_text, color, is_markdown=False, silent=True)

                        summary = self._clean_tool_summary(tool_name, tool_output_content)
                        self.render_tool_result_box(agent_name, color, summary, silent=True)
                    else:
                        clean_content = re.sub(r'^\s*(?:\[(?:Time|Today\'s date)[^\]]*\]\s*)+', '', content, flags=re.IGNORECASE).strip()
                        self.write_message_block(f"[bold {u_color}]{u_name}:[/bold {u_color}]", clean_content, u_color, is_markdown=True, silent=True)
        except Exception as e:
            self.log_to_ui(f"[bold red]Failed to load session:[/bold red] {e}")

def log_keyring_diagnostics():
    try:
        return toolbox.is_keyring_locked()
    except Exception:
        return False

def handle_client_message(view, data):
    action = data.get("action")

    if action in ("get_status", "ui_ready"):
        keyring_locked = log_keyring_diagnostics()
        if keyring_locked:
            view.send_to_electron({"type": "keyring_unlock_required"})
        else:
            view.update_status_bar()
            view.send_to_electron({
                "type": "init",
                "session_token": view.session_token,
                "active_agent": view.active_agent.name,
                "default_agent": view.agent_manager.get_default_agent_name(),
                "agents": [{"name": a.name, "color": a.color, "model": a.model} for a in view.agent_manager.agents.values()],
                "needs_onboarding": view.is_onboarding_needed()
            })
        return

    if action == "keyring_unlock":
        pwd = data.get("password", "").strip()
        if toolbox.unlock_keyring(pwd):
            view.send_to_electron({"type": "keyring_unlock_success"})
            view.update_status_bar()
            view.send_to_electron({
                "type": "init",
                "session_token": view.session_token,
                "active_agent": view.active_agent.name,
                "agents": [{"name": a.name, "color": a.color, "model": a.model} for a in view.agent_manager.agents.values()],
                "needs_onboarding": view.is_onboarding_needed()
            })
        else:
            view.send_to_electron({"type": "keyring_unlock_failed", "error": "Unlock failed. Password incorrect."})
        return

    if action == "keyring_reset":
        pwd = data.get("password", "").strip()
        try:
            import keyring
            backend = keyring.get_keyring()
            backends = [backend]
            if hasattr(backend, "backends"):
                backends.extend(backend.backends)
            for b in backends:
                if type(b).__name__ == "EncryptedKeyring":
                    if hasattr(b, "file_path") and b.file_path and os.path.exists(b.file_path):
                        os.remove(b.file_path)
                    b.__dict__["keyring_key"] = pwd
            view.send_to_electron({"type": "keyring_unlock_success"})
            view.update_status_bar()
            view.send_to_electron({
                "type": "init",
                "session_token": view.session_token,
                "active_agent": view.active_agent.name,
                "agents": [{"name": a.name, "color": a.color, "model": a.model} for a in view.agent_manager.agents.values()],
                "needs_onboarding": view.is_onboarding_needed()
            })
        except Exception as e:
            view.send_to_electron({"type": "keyring_unlock_failed", "error": f"Reset failed: {e}"})
        return

    if action in ("save_attachment", "import_shared_file"):
        fname = data.get("filename", "")
        src = data.get("source_path", "").replace("file://", "")
        b64_data = data.get("data", "")
        dest_path = os.path.join(view.workspace_dir, fname)

        if src and os.path.exists(src):
            import shutil
            shutil.copy2(src, dest_path)
        elif fname and b64_data:
            import base64 as b64_lib
            if "," in b64_data:
                b64_data = b64_data.split(",", 1)[1]
            file_bytes = b64_lib.b64decode(b64_data)
            with open(dest_path, "wb") as f:
                f.write(file_bytes)
        return

    if action == "input":
        view.process_input(data.get("text", ""))
    elif action == "abort":
        view.action_abort()
    elif action == "clear_all":
        view.action_clear_all_contexts()
    elif action == "select_agent":
        view.select_agent(data.get("name"))
    elif action == "set_default_agent":
        target = data.get("name")
        if target and target in view.agent_manager.agents:
            view.agent_manager.set_default_agent_name(target)
            view.log_to_ui(f"[bold green]Default agent set to '{target}'.[/bold green]")
            view.send_to_electron({"type": "default_agent_set", "name": target})
    elif action == "set_mode":
        mode = data.get("mode")
        if mode in ("PLAN", "INTERMEDIATE", "EXECUTE"):
            view.agent_mode = mode
            view.update_status_bar()
            view.log_to_ui(f"System security permission mode: [bold]{view.agent_mode}[/bold]")
    elif action == "cycle_mode":
        view.toggle_plan_mode()
    elif action == "set_directory":
        view.set_directory(data.get("path"))
    elif action == "get_suggestions":
        view.get_suggestions(data.get("value", ""))
    elif action == "get_agent_data":
        view.get_agent_data(data.get("name"))
    elif action == "save_agent_data":
        view.save_agent_data(data.get("fields"), data.get("is_new", False), data.get("old_name"))
    elif action == "delete_agent":
        view.delete_agent(data.get("name"))
    elif action == "open_novnc":
        view.send_to_electron({"type": "open_novnc", "url": data.get("url", "http://127.0.0.1:6080/vnc.html?autoconnect=true&resize=remote")})
    elif action == "get_global_settings":
        view.get_global_settings()
    elif action == "save_global_settings":
        view.save_global_settings(data.get("settings"))
    elif action == "start_chatgpt_oauth":
        threading.Thread(target=view.run_chatgpt_oauth, daemon=True).start()
    elif action == "get_sessions":
        view.get_sessions_list()
    elif action == "get_schedules":
        view.get_schedules_data()
    elif action == "delete_schedule":
        t_id = data.get("id")
        if t_id:
            view.schedule_manager.delete_task(t_id)
            view.get_schedules_data()
    elif action == "load_session":
        view.load_session_file(data.get("path"))
    elif action == "list_workspace":
        rel_path = data.get("path", "").strip()
        target_dir = os.path.abspath(os.path.join(view.workspace_dir, rel_path))
        if not target_dir.startswith(view.workspace_dir) or not os.path.exists(target_dir):
            target_dir = view.workspace_dir
            rel_path = ""
        items = []
        try:
            for entry in sorted(os.listdir(target_dir)):
                if entry.startswith("."): continue
                full_p = os.path.join(target_dir, entry)
                is_dir = os.path.isdir(full_p)
                size = 0 if is_dir else os.path.getsize(full_p)
                items.append({"name": entry, "is_dir": is_dir, "size": size})
        except Exception:
            pass
        items.sort(key=lambda x: (not x["is_dir"], x["name"].lower()))
        view.send_to_electron({"type": "workspace_list", "current_path": rel_path, "items": items})
    elif action == "prepare_share":
        import zipfile, mimetypes, shutil
        rel_path = data.get("path", "").strip()
        is_folder = data.get("is_folder", False)
        target_path = os.path.abspath(os.path.join(view.workspace_dir, rel_path))
        
        if not target_path.startswith(view.workspace_dir) or not os.path.exists(target_path):
            return
            
        cache_dir = os.path.join(os.path.expanduser("~"), ".federate", "cache")
        os.makedirs(cache_dir, exist_ok=True)

        if is_folder:
            base_name = os.path.basename(target_path) or "workspace"
            out_filename = f"{base_name}.zip"
            dest_path = os.path.join(cache_dir, out_filename)
            with zipfile.ZipFile(dest_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
                for root, _, files in os.walk(target_path):
                    for f in files:
                        abs_file = os.path.join(root, f)
                        arcname = os.path.relpath(abs_file, target_path)
                        zipf.write(abs_file, arcname)
            mime_type = "application/zip"
        else:
            out_filename = os.path.basename(target_path)
            dest_path = os.path.join(cache_dir, out_filename)
            shutil.copy2(target_path, dest_path)
            mime_type = mimetypes.guess_type(out_filename)[0] or "application/octet-stream"

        view.send_to_electron({
            "type": "share_file_path",
            "filename": out_filename,
            "path": dest_path,
            "mime_type": mime_type
        })
    elif action == "delete_workspace_item":
        import shutil
        rel_path = data.get("path", "").strip()
        is_folder = data.get("is_folder", False)
        target_path = os.path.abspath(os.path.join(view.workspace_dir, rel_path))
        
        if target_path == view.workspace_dir or not target_path.startswith(view.workspace_dir + os.sep) or not os.path.exists(target_path):
            view.log_to_ui(f"[bold red]Cannot delete protected or non-existent path: {rel_path}[/]")
            return
            
        try:
            if is_folder:
                shutil.rmtree(target_path)
            else:
                os.remove(target_path)
            view.log_to_ui(f"[bold green]Deleted:[/] {rel_path}")
            parent_rel = os.path.dirname(rel_path)
            handle_client_message(view, {"action": "list_workspace", "path": parent_rel})
        except Exception as e:
            view.log_to_ui(f"[bold red]Failed to delete item:[/] {e}")

    elif action == "clear_workspace_cache":
        import shutil
        cache_dir = os.path.join(os.path.expanduser("~"), ".federate", "cache")
        cleared_count = 0
        if os.path.exists(cache_dir):
            for entry in os.listdir(cache_dir):
                full_p = os.path.join(cache_dir, entry)
                try:
                    if os.path.isdir(full_p):
                        shutil.rmtree(full_p)
                    else:
                        os.remove(full_p)
                    cleared_count += 1
                except Exception:
                    pass
        view.send_to_electron({"type": "workspace_cache_cleared", "count": cleared_count})
    elif action == "tool_response":
        call_id = data.get("call_id")
        approved = data.get("approved")
        response_val = data.get("response", approved)
        view.tool_confirmation_results[call_id] = response_val if response_val is not None else approved
        if call_id in view.pending_tool_confirmations:
            view.pending_tool_confirmations[call_id].set()

def main():
    view = HeadlessAgentView()
    keyring_locked = log_keyring_diagnostics()
    if keyring_locked:
        view.send_to_electron({"type": "keyring_unlock_required"})
    else:
        view.update_status_bar()
        view.send_to_electron({
            "type": "init",
            "session_token": view.session_token,
            "active_agent": view.active_agent.name,
            "agents": [{"name": a.name, "color": a.color, "model": a.model} for a in view.agent_manager.agents.values()],
            "needs_onboarding": view.is_onboarding_needed()
        })

    for raw_line in sys.stdin:
        line = raw_line.strip()
        if not line:
            continue
        try:
            data = json.loads(line)
            handle_client_message(view, data)
        except Exception as e:
            view.log_to_ui(f"IPC Parse Error: {e}")

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        pass