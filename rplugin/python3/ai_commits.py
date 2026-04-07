from pathlib import Path
import os
import pynvim
import subprocess
import sys

py_ver = f"python{sys.version_info.major}.{sys.version_info.minor}"
PLUGIN_ROOT = Path(__file__).resolve().parent
VENV_DIR = PLUGIN_ROOT / ".venv"
LIB_PATH = VENV_DIR / "lib" / py_ver / "site-packages"
PYTH_PATH = VENV_DIR / "bin" / "python"


def bootstrap():
    if not os.path.exists(VENV_DIR):
        subprocess.run(["uv", "venv", VENV_DIR], check=True)
        cmd = ["uv", "pip", "install", "--python", PYTH_PATH]
        cmd += ["langchain-openai", "pynvim"]
        subprocess.run(cmd, check=True)


@pynvim.plugin
class AICommitsPlugin:
    def __init__(self, nvim):
        self.nvim = nvim

    @pynvim.command("AICommits", sync=False)
    def ai_commits(self):
        bootstrap()
        if LIB_PATH not in sys.path:
            sys.path.insert(0, str(LIB_PATH))

        from langchain_openai import ChatOpenAI

        try:
            diff = subprocess.check_output(["git", "diff", "--cached"], text=True)
            if not diff:
                self.nvim.out_write("No changes to commit.\n")
                return

            token_path = Path("~/.ai_token").expanduser()
            with open(token_path, "r") as f:
                api_key = f.read().strip()

            llm = ChatOpenAI(
                api_key=api_key,
                base_url="https://openrouter.ai/api/v1",
                model="openai/gpt-oss-120b:free",
            )

            prompt_arr = [
                "Generate a concise git commit message with the contents",
                "of the diff based on the specification specified below.",
                "Exclude unnecessary translations and extra information,",
                "and provide it in a way that can be used directly for git commits.",
                "The answer is in Russian, in the past tense, up to 120 characters.",
                "",
                "### diff",
                diff,
            ]
            res = llm.invoke("\n".join(prompt_arr))
            msg = res.content.strip()

            choice = self.nvim.call(
                "confirm",
                f'Commit with message: "{msg}"',
                "&Yes\n&No",
            )
            if choice == 1:
                subprocess.run(["git", "commit", "-m", msg])
                self.nvim.out_write("Committed!\n")
        except Exception as e:
            self.nvim.err_write(f"Error: {str(e)}\n")
