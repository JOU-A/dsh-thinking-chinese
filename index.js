/**
 * dsh-thinking-chinese —— 强制 DeepSeek Harness 里所有模型的思考链使用简体中文。
 *
 * ## 实现原理
 *
 * DSH 没有「思考语言」这一类 provider 线上参数，模型收到什么语言的指令，
 * 就倾向用什么语言推理。本插件走官方扩展点 `dsh-system-prompt`：
 *
 * 1. 注册一个全局 **section**（系统提示词层）——每个 agent、每个子代理、
 *    每个 scope、每次模型请求都会重新装配并发送，因此对全 profile 的全部
 *    模型与推理强度统一生效；
 * 2. 可选再注册一条 **context**（运行时上下文快照，贴近对话的用户角色层），
 *    作为更靠近对话位置的二次提醒，提高对强推理模型的约束力。
 *
 * 两条注册都只新增提示词内容，不改写任何请求对象，因而不会破坏
 * 「请求是会话日志的纯函数」这一可重建性约定，也不会影响 KV cache 复用
 * （内容稳定，装配结果逐字节一致）。
 *
 * ## 已知边界
 *
 * 不经过 agent 循环的一次性调用（会话标题生成、上下文压缩摘要、
 * 视觉理解等 `purpose` 调用）不消费系统提示词装配，本插件无法覆盖；
 * 这些调用的思考过程用户不可见，也不改变最终产物语言。
 *
 * 本文件零外部依赖（只用宿主注入的 `systemPrompt` 服务），
 * 因此无论 pnpm 以复制还是软链方式安装都能正常解析。
 *
 * @module dsh-thinking-chinese
 */

/** Cordis 插件名。 */
export const name = 'thinking-chinese'
/** 依赖提示词注册表服务（必需注入）。 */
export const inject = ['systemPrompt']

/** 系统提示词 section 名称，全局唯一，重复注册会抛错。 */
const SECTION_NAME = 'reasoning:language'
/** 运行时上下文快照条目名称，作用域内唯一。 */
const CONTEXT_NAME = 'thinking-chinese'
/**
 * section 排序位：DSH 的人格前缀（0）之后、计划策略（500）之前，
 * 保证指令出现在提示词靠前的位置，又不会顶掉部署人格。
 */
const SECTION_ORDER = 100
/** 快照排序位：排在沙箱（110）/审批（115）策略之前，最先被读到。 */
const CONTEXT_ORDER = 100

const DEFAULT_LANGUAGE = '简体中文（Simplified Chinese）'

/**
 * 系统提示词正文。`%LANGUAGE%` 会被配置的语言名替换。
 * 刻意中英双语：英文提示词为主的模型同样要遵守。
 */
const DEFAULT_SECTION_TEXT = `## 强制思考语言 / Mandatory Reasoning Language

以下为不可协商的硬性规则，优先于任何语言偏好：

1. 你的整条思考链——所有内部推理、隐藏思考、reasoning / thinking 内容、
   草稿与自我对话——必须全程使用 %LANGUAGE% 书写。
2. 直接用 %LANGUAGE% 思考：不要先用英文思考再翻译，也不要因为系统提示词、
   工具说明、代码或用户消息是英文就切换成英文思考。
3. 代码、命令、API 与工具名、专有名词、报错和日志原文保持原样，不必翻译，
   可以直接嵌在 %LANGUAGE% 思考里。
4. 本条只约束思考过程：最终回答的语言仍由用户决定（用户用中文提问时，
   用简体中文回答）。

Mandatory: your ENTIRE chain of thought — every reasoning block, hidden
thought, draft and self-dialogue — must be written in %LANGUAGE%. Never think
in English (or any other language), regardless of the language of the system
prompt, tools, code, or user messages. Keep code, commands, identifiers, proper
nouns and raw errors verbatim. The final reply language still follows the user.`

/** 贴近对话位置的二次提醒（运行时上下文快照）。 */
const DEFAULT_CONTEXT_TEXT =
  '[强制] 思考语言：%LANGUAGE% —— 本会话中所有模型的思考链（thinking / reasoning）必须使用该语言，禁止用英文思考。'

/** 允许的配置键；写错键名时给出可读诊断而不是静默忽略。 */
const KNOWN_KEYS = ['enabled', 'language', 'sectionText', 'contextText', 'reinforce', 'sectionOrder', 'contextOrder']

/**
 * 归一化插件配置：补默认值、校验类型。
 * 不导出 schemastery schema，避免安装形态差异带来的裸包名解析问题。
 * @param {Record<string, unknown>} raw - 配置行里的 config 对象。
 * @returns {{
 *   enabled: boolean, language: string, sectionText: string,
 *   contextText: string, reinforce: boolean,
 *   sectionOrder: number, contextOrder: number
 * }}
 */
function normalizeConfig(raw) {
	const config = raw && typeof raw === 'object' ? raw : {}
	const unknown = Object.keys(config).filter((key) => !KNOWN_KEYS.includes(key))
	if (unknown.length > 0) {
		throw new Error(`dsh-thinking-chinese: 未知配置项 ${unknown.join(', ')}；支持：${KNOWN_KEYS.join(', ')}`)
	}
	const bool = (value, fallback) => typeof value === 'boolean' ? value : fallback
	const text = (value, fallback) => typeof value === 'string' && value.trim() !== '' ? value : fallback
	const order = (value, fallback) => Number.isFinite(value) ? Number(value) : fallback
	return {
		enabled: bool(config.enabled, true),
		language: text(config.language, DEFAULT_LANGUAGE),
		sectionText: text(config.sectionText, DEFAULT_SECTION_TEXT),
		contextText: text(config.contextText, DEFAULT_CONTEXT_TEXT),
		reinforce: bool(config.reinforce, true),
		sectionOrder: order(config.sectionOrder, SECTION_ORDER),
		contextOrder: order(config.contextOrder, CONTEXT_ORDER)
	}
}

/**
 * 替换 `%LANGUAGE%` 占位符（不使用 `{{var}}`，避免触发提示词变量的严格插值）。
 * @param {string} template - 模板正文。
 * @param {string} language - 语言名。
 * @returns {string}
 */
function render(template, language) {
	return template.split('%LANGUAGE%').join(language)
}

/**
 * 在全局提示词注册表里登记思考语言约束。
 * @param {import('@deepseek-ai/cordis').Context} ctx - 插件上下文。
 * @param {Record<string, unknown>} raw - 未校验的配置。
 */
export function apply(ctx, raw) {
	const config = normalizeConfig(raw)
	if (!config.enabled) return

	ctx.effect(() => ctx.systemPrompt.section({
		name: SECTION_NAME,
		order: config.sectionOrder,
		text: render(config.sectionText, config.language),
		// 自定义正文里出现 {{ 也按字面处理，绝不因变量缺失让装配失败。
		interpolate: false
	}), 'thinking-chinese.section()')

	if (config.reinforce) {
		ctx.effect(() => ctx.systemPrompt.context({
			name: CONTEXT_NAME,
			order: config.contextOrder,
			text: render(config.contextText, config.language)
		}), 'thinking-chinese.context()')
	}
}

export { DEFAULT_LANGUAGE, SECTION_NAME, CONTEXT_NAME }
