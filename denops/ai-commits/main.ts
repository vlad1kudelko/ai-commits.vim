import { Denops } from "https://deno.land/x/denops_std@v2.0.0/mod.ts";
import { ChatOpenAI } from "npm:@langchain/openai";
import { PromptTemplate } from "npm:@langchain/core/prompts";
import { join } from "https://deno.land/std/path/mod.ts";

async function getApiKey(): Promise<string> {
    try {
        const home = Deno.env.get("HOME") || "";
        const tokenPath = join(home, ".ai_token");
        const token = await Deno.readTextFile(tokenPath);
        return token.trim();
    } catch (error) {
        throw new Error(`Не удалось прочитать токен из ~/.ai_token: ${error.message}`);
    }
}

async function getLlm() {
    const apiKey = await getApiKey();
    return new ChatOpenAI({
        apiKey: apiKey,
        configuration: {
            baseURL: "https://openrouter.ai/api/v1",
            defaultHeaders: {
                "HTTP-Referer": "https://github.com/denops/denops.vim", // Опционально для OpenRouter
                "X-Title": "Denops AI Commits",
            },
        },
        modelName: "openrouter/free",
    });
}

const promptTemplate = new PromptTemplate({
    inputVariables: ["input"],
    template: [
        "Generate a concise git commit message with the contents of the diff based on the specification specified below.",
        "Exclude unnecessary translations and extra information, and provide it in a way that can be used directly for git commits.",
        "The answer is in Russian, in the past tense, up to 120 characters.",
        "",
        "### diff",
        "{input}",
    ].join("\n"),
});

async function sendChatMessage(text: string) {
    const llm = await getLlm();
    const prompt = await promptTemplate.format({ input: text });
    const response = await llm.invoke(prompt);
    return response.content.toString().trim();
}

async function runGitCommand(args: string[]): Promise<string> {
    const command = new Deno.Command("git", {
        args: args,
        stdout: "piped",
        stderr: "piped",
    });
    const { code, stdout, stderr } = await command.output();
    if (code !== 0) {
        const errorOutput = new TextDecoder().decode(stderr);
        throw new Error(`Git command failed: ${errorOutput}`);
    }
    return new TextDecoder().decode(stdout);
}

export async function main(denops: Denops): Promise<void> {
    denops.dispatcher = {
        async aiCommits(): Promise<void> {
            try {
                const gitDiffResult = await runGitCommand(["diff", "--cached"]);
                if (gitDiffResult === "") {
                    // Если стейдж пуст, пробуем обычный diff
                    const unstagedDiff = await runGitCommand(["diff"]);
                    if (unstagedDiff === "") {
                        console.log("No changes to commit.");
                        return;
                    }
                }

                const commitMessage = await sendChatMessage(gitDiffResult);
                const shouldCommit = await denops.call(
                    "input",
                    `Commit this? / message: ${commitMessage} | [y/n]: `
                );

                if (String(shouldCommit).toLowerCase() === "y") {
                    // Если мы уже делали diff --cached, git add . может быть лишним,
                    // но оставим для совместимости с вашим флоу
                    await runGitCommand(["add", "."]);
                    await runGitCommand(["commit", "-m", commitMessage]);
                    console.log("Committed successfully!");
                }
            } catch (error) {
                console.error("Error in aiCommits:", error);
            }
        },
    };

    await denops.cmd(
        `command! AICommits call denops#notify("${denops.name}", "aiCommits", [])`
    );
}
