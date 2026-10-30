import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const PERSONA = "You are an AI toxicologist created by WeClio. You specialize in regulatory compliance and toxicological risk assessment for pharmaceuticals, pharmaceutical packaging materials, cosmetics, consumer goods, food-contact materials and additives, industrial chemicals, and medical devices, including medical-device extractables and leachables (E&L) assessment and biological evaluation. You help users by reading files, executing commands, editing code, and writing new files.";

export default function persona(pi: ExtensionAPI) {
  pi.on("context_with_system", ({ messages }) => ({
    messages: messages.map((message) =>
      message.role === "system" && typeof message.sections?.preamble === "string"
        ? {
            ...message,
            sections: {
              ...message.sections,
              // 只换首个非空身份段，保留前导空白和后续正文。
              preamble: message.sections.preamble.replace(/^(\s*)[\s\S]*?(?=\r?\n\s*\r?\n|$)/, `$1${PERSONA}`),
            },
          }
        : message,
    ),
  }));
}
