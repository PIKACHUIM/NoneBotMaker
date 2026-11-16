import type { LocalizedText } from './types';

export interface BuiltinChatCommand {
  name: string;
  usage: string;
  description: LocalizedText;
  ownerOnly: boolean;
}

/** Chat commands handled directly by the chatbot runtime. */
export const BUILTIN_CHAT_COMMANDS: BuiltinChatCommand[] = [
  { name: 'help', usage: '/help', ownerOnly: false, description: { zh: '显示当前可用的命令菜单', en: 'Show the available command menu' } },
  { name: 'status', usage: '/status', ownerOnly: false, description: { zh: '查看当前会话模式、模型、上下文与记忆状态', en: 'Show conversation mode, model, context and memory status' } },
  { name: 'openid', usage: '/openid', ownerOnly: false, description: { zh: '查看用户与群聊 openid，便于首次接入', en: 'Show user and group openids for first-time setup' } },
  { name: 'reset', usage: '/reset', ownerOnly: false, description: { zh: '清空当前会话上下文', en: 'Clear the current conversation context' } },
  { name: 'role', usage: '/role list|show <名称>|use <名称>|add <名称> <内容>|delete <名称>', ownerOnly: false, description: { zh: '查看或切换会话角色卡；写入操作仅 owner', en: 'List or switch role cards; writes are owner-only' } },
  { name: 'memory', usage: '/memory list|search <关键词>|show <名称>|add <名称> <内容>|delete <名称>', ownerOnly: false, description: { zh: '查看会话记忆；写入与删除仅 owner', en: 'Inspect conversation memories; writes and deletes are owner-only' } },
  { name: 'save', usage: '/save <名称> <内容>', ownerOnly: true, description: { zh: '明确保存一条会话记忆', en: 'Explicitly save a conversation memory' } },
  { name: 'slang', usage: '/slang list|show|approve|reject|update|delete', ownerOnly: false, description: { zh: '查看群聊用语候选；审核操作仅 owner', en: 'Inspect slang candidates; review actions are owner-only' } },
  { name: 'voice', usage: '/voice list|save|delete', ownerOnly: false, description: { zh: '查看账号语音素材；写入与删除仅 owner', en: 'List voice assets; writes and deletes are owner-only' } },
  { name: 'mode', usage: '/mode chat|reserved|reserved2|closed-agent', ownerOnly: true, description: { zh: '切换当前会话运行模式', en: 'Switch the conversation runtime mode' } },
  { name: 'silent', usage: '/silent', ownerOnly: true, description: { zh: '进入静默模式，停止自动回复', en: 'Enter silent mode and stop automatic replies' } },
  { name: 'active', usage: '/active', ownerOnly: true, description: { zh: '退出静默模式，恢复响应', en: 'Leave silent mode and resume replies' } },
  { name: 'prompt', usage: '/prompt <文本>|clear', ownerOnly: true, description: { zh: '设置或清除一次性提示', en: 'Set or clear the one-shot prompt' } },
  { name: 'tools', usage: '/tools list|disable <名称>|enable <名称>|reset', ownerOnly: true, description: { zh: '管理当前会话的工具开关', en: 'Manage tools for the current conversation' } },
  { name: 'wake', usage: '/wake list|/wake cancel <id>', ownerOnly: true, description: { zh: '查看或取消计划唤醒', en: 'List or cancel scheduled wakes' } },
  { name: 'approvals', usage: '/approvals', ownerOnly: true, description: { zh: '查看待审批的工具调用', en: 'List pending tool approvals' } },
  { name: 'approval', usage: '/approval <id> [offset]', ownerOnly: true, description: { zh: '分页查看待审批工具参数', en: 'Page through pending tool arguments' } },
  { name: 'approve', usage: '/approve <id>', ownerOnly: true, description: { zh: '批准并执行待审批工具', en: 'Approve and execute a pending tool' } },
  { name: 'reject', usage: '/reject <id>', ownerOnly: true, description: { zh: '拒绝待审批工具', en: 'Reject a pending tool call' } },
];

export const BUILTIN_COMMAND_NAMES = new Set(BUILTIN_CHAT_COMMANDS.map((command) => command.name));

export interface ParsedChatCommand {
  name: string;
  args: string;
}

/** Parses `/name args` without interpreting the argument text. */
export function parseChatCommand(text: string): ParsedChatCommand | null {
  const match = /^\/([A-Za-z][A-Za-z0-9_-]{0,31})(?:\s+([\s\S]*))?$/.exec(text.trim());
  if (!match) return null;
  return { name: match[1].toLowerCase(), args: (match[2] ?? '').trim() };
}

export interface CommandTemplateContext {
  args: string;
  user: string;
  userName: string;
  group: string;
  groupName: string;
  command: string;
  time: string;
}

const TEMPLATE_LIMIT = 8000;

/** Renders a prompt-command template; args are appended when no placeholder exists. */
export function renderCommandPrompt(template: string, context: CommandTemplateContext): string {
  let rendered = template.slice(0, TEMPLATE_LIMIT);
  const hasArgsPlaceholder = /\{args\}/i.test(rendered);
  rendered = rendered
    .replace(/\{args\}/gi, context.args)
    .replace(/\{userName\}/gi, context.userName)
    .replace(/\{user\}/gi, context.user)
    .replace(/\{groupName\}/gi, context.groupName)
    .replace(/\{group\}/gi, context.group)
    .replace(/\{command\}/gi, context.command)
    .replace(/\{time\}/gi, context.time);
  if (!hasArgsPlaceholder && context.args) rendered += `\n\n用户输入：${context.args}`;
  return rendered.trim();
}

/** Placeholder-only rendering used by scheduled messages. */
export function renderScheduleText(template: string, values: { name: string; time: string; args?: string }): string {
  return template
    .replace(/\{name\}/gi, values.name)
    .replace(/\{time\}/gi, values.time)
    .replace(/\{args\}/gi, values.args ?? '')
    .slice(0, 8000)
    .trim();
}
