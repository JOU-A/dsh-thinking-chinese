// dsh-thinking-chinese 自检：加载插件并模拟一次注册。
const mod = await import('./index.js')
const sections = []
const contexts = []
const ctx = {
	effect(fn, label) {
		const off = fn()
		return typeof off === 'function' ? off : () => {}
	},
	systemPrompt: {
		section(s) { sections.push(s); return () => {} },
		context(c) { contexts.push(c); return () => {} }
	}
}
mod.apply(ctx, {})
mod.apply(ctx, { language: '繁體中文', reinforce: false, sectionOrder: 42 })
mod.apply(ctx, { enabled: false, sectionText: 'nope' })
let threw = null
try { mod.apply(ctx, { unknownKey: 1 }) } catch (e) { threw = e.message }
console.log(JSON.stringify({
	exports: Object.keys(mod),
	name: mod.name,
	inject: mod.inject,
	sectionCount: sections.length,
	contextCount: contexts.length,
	orders: [sections[0].order, sections[1].order],
	interpolate: sections[0].interpolate,
	firstHasChinese: sections[0].text.includes('简体中文（Simplified Chinese）'),
	firstHasEnglishRule: sections[0].text.includes('must be written in'),
	langReplaced: sections[1].text.includes('繁體中文') && !sections[1].text.includes('%LANGUAGE%'),
	enabledFalseSkipped: sections.length === 2 && contexts.length === 1,
	unknownKeyError: threw
}, null, 2))
