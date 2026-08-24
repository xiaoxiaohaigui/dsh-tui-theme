/**
 * /settings integration (seam six: tuiSettingsSections over the dsh settings
 * service).
 *
 * Registers the `pink-theme` settings namespace and a declarative editing
 * section for it. Storage, schema validation, and layered resolution stay on
 * the dsh settings service; the TUI only renders. Fields carry no schema
 * defaults on purpose — an unset user layer must fall through to the cordis
 * config layer (mirrors the host's own lang/fullscreen fields), and format()
 * displays the effective value instead of a misleading blank.
 *
 * Both services are consumed through `ctx.inject`, not apply-time `get`
 * probes: this row may start before the host's service rows, and the inject
 * fires whenever each service actually registers.
 * @module dsh-tui-pink-theme/settingsSection
 */
import { settingsNamespace } from '@deepseek-ai/dsh-settings';
import z from '@deepseek-ai/schemastery';
/**
 * Register the settings namespace (mirror the resolved document to the
 * caller) and, separately, the /settings section for it. Each part waits for
 * its own service; neither is required for the other.
 *
 * @param ctx - The plugin's own activation context.
 * @param cordis - The cordis-config layer (shown as the effective value for
 *   still-unset fields).
 * @param onDoc - Called with the defined-valued subset of the settings doc,
 *   initially and on every committed edit.
 */
export function registerPinkSettings(ctx, cordis, onDoc) {
    ctx.inject(['settings'], settingsCtx => {
        const settings = settingsCtx.settings;
        try {
            const scope = settings.register(settingsNamespace('dsh-tui-theme'), z.object({
                followSystem: z.boolean(),
                showGlyph: z.boolean(),
                showClock: z.boolean(),
                showTurns: z.boolean(),
                statusScope: z.union(['pink-only', 'all-themes']),
            }));
            const emit = (doc) => {
                if (doc === null || typeof doc !== 'object')
                    return;
                const clean = {};
                for (const [key, value] of Object.entries(doc)) {
                    if (value !== undefined)
                        clean[key] = value;
                }
                onDoc(clean);
            };
            // Own the watcher on the inject-scoped ledger so it survives exactly as
            // long as this activation (scope.watch's disposer is otherwise leaked).
            settingsCtx.effect(() => {
                emit(scope.get());
                return scope.watch(emit);
            });
        }
        catch (error) {
            // A duplicate registration (hot reload race) or a stricter host must
            // not take the plugin — or the TUI — down.
            settingsCtx.logger.warn(`dsh-tui-pink-theme: settings namespace registration failed: ${String(error)}`);
        }
    });
    ctx.inject(['tuiSettingsSections'], sectionsCtx => {
        const sections = sectionsCtx
            .tuiSettingsSections;
        try {
            const unregister = sections.register(sectionDefinition(cordis));
            sectionsCtx.effect(() => () => unregister());
        }
        catch (error) {
            // A duplicate registration (hot reload race) or a stricter host must
            // not take the plugin — or the TUI — down.
            sectionsCtx.logger.warn(`dsh-tui-pink-theme: settings section registration failed: ${String(error)}`);
        }
    });
}
/** The declarative /settings block (labels bilingual, zh via descriptions). */
function sectionDefinition(cordis) {
    return {
        ns: 'dsh-tui-theme',
        title: 'pink-theme',
        descriptions: { zh: 'pink-theme' },
        fields: [
            {
                path: ['followSystem'],
                label: 'Follow terminal background',
                descriptions: { zh: '跟随终端背景' },
                hint: 'Auto-switch between Pink Day and Pink Night by terminal/system background. First enabling or a background flip applies from the next boot.',
                hintDescriptions: {
                    zh: '按终端/系统背景色在昼樱与夜樱间自动切换。首次开启或背景刚翻转后，自下次启动生效。',
                },
                kind: 'boolean',
                format: (value) => String(value ?? cordis.followSystem),
            },
            {
                path: ['showGlyph'],
                label: 'Blossom ✿',
                descriptions: { zh: '花符 ✿' },
                hint: 'Lead the decorative line above the prompt with ✿.',
                hintDescriptions: { zh: '输入框上方装饰行的开头花符。' },
                kind: 'boolean',
                format: (value) => String(value ?? cordis.showGlyph),
            },
            {
                path: ['showClock'],
                label: 'Clock',
                descriptions: { zh: '时钟' },
                kind: 'boolean',
                format: (value) => String(value ?? cordis.showClock),
            },
            {
                path: ['showTurns'],
                label: 'Turn count',
                descriptions: { zh: '轮数' },
                hint: 'Turns of the live session counted since the TUI started.',
                hintDescriptions: { zh: '自本次启动以来当前会话的轮数。' },
                kind: 'boolean',
                format: (value) => String(value ?? cordis.showTurns),
            },
            {
                path: ['statusScope'],
                label: 'Status line display',
                descriptions: { zh: '状态行展示' },
                hint: 'The blossom line is exclusive to the pink palettes by default; all-themes keeps it visible under other themes.',
                hintDescriptions: {
                    zh: '状态行默认为樱花粉主题专属；所有主题时在其他主题下同样显示。',
                },
                kind: 'select',
                options: [
                    { value: 'pink-only', label: 'Pink themes only', descriptions: { zh: '樱花粉主题' } },
                    { value: 'all-themes', label: 'All themes', descriptions: { zh: '所有主题' } },
                ],
                format: (value) => typeof value === 'string' ? value : (cordis.statusScope ?? 'pink-only'),
            },
        ],
    };
}
