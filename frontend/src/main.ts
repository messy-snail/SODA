import './globe/cesiumBase'
import 'cesium/Build/Cesium/Widgets/widgets.css'
import { createPinia } from 'pinia'
import { createApp, h } from 'vue'
import { useI18n } from 'vue-i18n'
import { createVuetify } from 'vuetify'
import { createVueI18nAdapter } from 'vuetify/locale/adapters/vue-i18n'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'
import { i18n } from './i18n'

type AdapterI18n = Parameters<typeof createVueI18nAdapter>[0]['i18n']
import {
  AlertCircle,
  Check,
  CheckCircle,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Circle,
  Info,
  Menu,
  Minus,
  Square,
  X,
} from 'lucide-vue-next'
import 'vuetify/styles'
import './styles.css'
import './styles/shell.css'
import './styles/glass.css'
import App from './App.vue'
import { vuetifyThemes } from './theme/presets'

const icon = (component: typeof Check) => () => h(component, { size: 18, 'aria-hidden': true })
const aliases = Object.fromEntries(
  Object.entries({
    complete: Check,
    cancel: X,
    close: X,
    delete: X,
    clear: X,
    success: CheckCircle,
    info: Info,
    warning: AlertCircle,
    error: AlertCircle,
    dropdown: ChevronDown,
    expand: ChevronDown,
    collapse: ChevronDown,
    prev: ChevronLeft,
    next: ChevronRight,
    first: ChevronsLeft,
    last: ChevronsRight,
    menu: Menu,
    checkboxOn: Check,
    checkboxOff: Square,
    checkboxIndeterminate: Minus,
    radioOn: Circle,
    radioOff: Circle,
  }).map(([name, component]) => [name, icon(component)]),
)

const vuetify = createVuetify({
  components,
  directives,
  icons: { aliases },
  // The adapter's I18n generic does not line up with a typed message schema.
  locale: { adapter: createVueI18nAdapter({ i18n: i18n as unknown as AdapterI18n, useI18n }) },
  theme: { defaultTheme: 'sodaDark', themes: vuetifyThemes },
  defaults: {
    VTextField: { variant: 'outlined', density: 'compact', hideDetails: 'auto' },
    VSelect: { variant: 'outlined', density: 'compact', hideDetails: 'auto' },
    VBtn: { rounded: 'lg', elevation: 0 },
    VBtnToggle: { divided: true, mandatory: true, variant: 'outlined', color: 'primary' },
    VCard: { rounded: 'lg', elevation: 0 },
    VSwitch: { color: 'primary', density: 'compact', hideDetails: true, inset: true },
    VChip: { size: 'small', variant: 'tonal' },
  },
})

// i18n has to be installed before Vuetify so the adapter finds its composer.
createApp(App).use(createPinia()).use(i18n).use(vuetify).mount('#app')
