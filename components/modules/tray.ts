




import GLib from "gi://GLib"
import Gio from "gi://Gio"
import GdkPixbuf from "gi://GdkPixbuf"
import Gtk from "gi://Gtk?version=3.0"

const bus = Gio.DBus.session
const WATCHER = "org.kde.StatusNotifierWatcher"
const WATCHER_PATH = "/StatusNotifierWatcher"
const SNI = "org.kde.StatusNotifierItem"
const PROPS = "org.freedesktop.DBus.Properties"
const DBUSMENU = "com.canonical.dbusmenu"

export interface TrayItem {
    key: string; bus: string; path: string
    id: string; title: string; status: string
    iconName: string; iconThemePath: string; isMenu: boolean; menuPath: string
    pixbuf: any
}

let items: TrayItem[] = []
const listeners: (() => void)[] = []
const subs: number[] = []
let started = false

export const onTrayChange = (cb: () => void) => { listeners.push(cb) }
const notify = () => { for (const cb of listeners) { try { cb() } catch (e) { print("[tray] cb:", e) } } }
export const getTrayItems = () => items


const splitReg = (s: string): [string, string] => {
    const i = s.indexOf("/")
    return i < 0 ? [s, "/StatusNotifierItem"] : [s.slice(0, i), s.slice(i)]
}
const keyOf = (bus: string, path: string) => `${bus}${path}`


const call = (dest: string, path: string, iface: string, method: string, params: any, reply: string): Promise<any> =>
    new Promise((res) => {
        try {
            bus.call(dest, path, iface, method, params, reply ? new GLib.VariantType(reply) : null,
                Gio.DBusCallFlags.NONE, 3000, null, (_c, r) => {
                    try { res(bus.call_finish(r)) } catch { res(null) }
                })
        } catch { res(null) }
    })

const getAllProps = (bus_: string, path: string): Promise<any> =>
    call(bus_, path, PROPS, "GetAll", new GLib.Variant("(s)", [SNI]), "(a{sv})")



const pixbufFromPixmap = (variant: any): any => {
    try {
        const arr = variant.deep_unpack() as any[]
        if (!arr || !arr.length) return null
        let best: any = null
        for (const p of arr) { const w = p[0]; if (!best || w > best[0]) best = p }
        if (!best) return null
        const w = best[0], h = best[1], src = best[2]
        if (!w || !h || !src || src.length < w * h * 4) return null
        const out = new Uint8Array(w * h * 4)
        for (let i = 0; i < w * h; i++) {
            const a = src[i * 4], r = src[i * 4 + 1], g = src[i * 4 + 2], b = src[i * 4 + 3]
            out[i * 4] = r; out[i * 4 + 1] = g; out[i * 4 + 2] = b; out[i * 4 + 3] = a
        }
        return GdkPixbuf.Pixbuf.new_from_bytes(new GLib.Bytes(out), GdkPixbuf.Colorspace.RGB, true, 8, w, h, w * 4)
    } catch (e) { print("[tray] pixmap:", e); return null }
}

const iconCache: any = {}

const resolveIcon = (it: TrayItem, propsDict: any) => {
    const name = it.iconName
    try {
        if (name && name.startsWith("/")) {
            if (!iconCache[name]) iconCache[name] = GdkPixbuf.Pixbuf.new_from_file_at_size(name, 40, 40)
            it.pixbuf = iconCache[name]; return
        }
        if (name) {
            const ck = it.iconThemePath + "|" + name
            if (iconCache[ck]) { it.pixbuf = iconCache[ck]; return }
            const theme = Gtk.IconTheme.get_default()
            if (it.iconThemePath) { try { theme.append_search_path(it.iconThemePath) } catch { } }
            const pb = theme.load_icon(name, 32, Gtk.IconLookupFlags.FORCE_SIZE)
            if (pb) { iconCache[ck] = pb; it.pixbuf = pb; return }
        }
    } catch {  }
    try { if (propsDict && propsDict.IconPixmap) it.pixbuf = pixbufFromPixmap(propsDict.IconPixmap) } catch { }
}

const readItem = (it: TrayItem) => {
    getAllProps(it.bus, it.path).then((r) => {
        if (!r) return
        let d: any = {}
        try { d = r.deep_unpack()[0] } catch { return }
        const S = (k: string) => { try { return d[k] ? d[k].deep_unpack() : "" } catch { return "" } }
        it.id = S("Id") || it.id
        it.title = S("Title") || it.id
        it.status = S("Status") || "Active"
        it.iconName = S("IconName") || ""
        it.iconThemePath = S("IconThemePath") || ""
        it.isMenu = !!S("ItemIsMenu")
        it.menuPath = S("Menu") || "/MenuBar"
        resolveIcon(it, d)
        notify()
    })
}

const watchItem = (it: TrayItem) => {

    for (const sig of ["NewIcon", "NewTitle", "NewStatus", "NewToolTip"]) {
        const id = bus.signal_subscribe(it.bus, SNI, sig, it.path, null, Gio.DBusSignalFlags.NONE,
            () => readItem(it))
        subs.push(id)
    }
}

const addItem = (reg: string) => {
    const [b, p] = splitReg(reg)
    const key = keyOf(b, p)
    if (items.some((x) => x.key === key)) return
    const it: TrayItem = { key, bus: b, path: p, id: "", title: "", status: "Active", iconName: "", iconThemePath: "", isMenu: false, menuPath: "/MenuBar", pixbuf: null }
    items.push(it); watchItem(it); readItem(it)
}
const removeItem = (reg: string) => {
    const [b, p] = splitReg(reg); const key = keyOf(b, p)
    items = items.filter((x) => x.key !== key)
    notify()
}


export const trayActivate = (it: TrayItem, x = 0, y = 0) => {
    call(it.bus, it.path, SNI, "Activate", new GLib.Variant("(ii)", [x | 0, y | 0]), "")
}
export const traySecondary = (it: TrayItem, x = 0, y = 0) => {
    call(it.bus, it.path, SNI, "SecondaryActivate", new GLib.Variant("(ii)", [x | 0, y | 0]), "")
}

export interface MenuNode { id: number; label: string; type: string; enabled: boolean; visible: boolean; children: MenuNode[]; toggle: string; checked: boolean }



const parseNode = (node: any): MenuNode => {
    const id = node[0]
    const props = node[1]
    const kids = node[2]
    const P = (k: string, def: any) => { try { return props[k] !== undefined ? props[k].deep_unpack() : def } catch { return def } }
    const children: MenuNode[] = []
    try { for (const c of kids) children.push(parseNode(c.deep_unpack())) } catch { }
    return {
        id, label: (P("label", "") + "").replace(/_/g, ""), type: P("type", "standard"),
        enabled: P("enabled", true), visible: P("visible", true),
        toggle: P("toggle-type", ""), checked: P("toggle-state", 0) === 1, children,
    }
}
export const trayMenu = (it: TrayItem): Promise<MenuNode[]> =>
    call(it.bus, it.menuPath, DBUSMENU, "GetLayout", new GLib.Variant("(iias)", [0, -1, []]), "(u(ia{sv}av))")
        .then((r) => {
            if (!r) return []
            try { const root = parseNode(r.deep_unpack()[1]); return root.children.filter((c) => c.visible) } catch (e) { print("[tray] menu:", e); return [] }
        })
export const trayMenuClick = (it: TrayItem, id: number) => {

    call(it.bus, it.menuPath, DBUSMENU, "AboutToShow", new GLib.Variant("(i)", [id]), "(b)").then(() => {
        call(it.bus, it.menuPath, DBUSMENU, "Event",
            new GLib.Variant("(isvu)", [id, "clicked", new GLib.Variant("s", ""), Math.floor(GLib.get_monotonic_time() / 1000) >>> 0]), "")
    })
}


const startHostMode = () => {
    call(WATCHER, WATCHER_PATH, WATCHER, "RegisterStatusNotifierHost", new GLib.Variant("(s)", [bus.get_unique_name() || "cyberpunk"]), "")
    subs.push(bus.signal_subscribe(null, WATCHER, "StatusNotifierItemRegistered", WATCHER_PATH, null, Gio.DBusSignalFlags.NONE,
        (_c, _s, _p, _i, _sig, params) => { try { addItem(params.deep_unpack()[0]) } catch { } }))
    subs.push(bus.signal_subscribe(null, WATCHER, "StatusNotifierItemUnregistered", WATCHER_PATH, null, Gio.DBusSignalFlags.NONE,
        (_c, _s, _p, _i, _sig, params) => { try { removeItem(params.deep_unpack()[0]) } catch { } }))
    call(WATCHER, WATCHER_PATH, PROPS, "Get", new GLib.Variant("(ss)", [WATCHER, "RegisteredStatusNotifierItems"]), "(v)")
        .then((r) => { if (!r) return; try { for (const reg of r.deep_unpack()[0].deep_unpack()) addItem(reg) } catch (e) { print("[tray] init:", e) } })
}



const WATCHER_XML = `<node><interface name="org.kde.StatusNotifierWatcher">
<method name="RegisterStatusNotifierItem"><arg type="s" direction="in"/></method>
<method name="RegisterStatusNotifierHost"><arg type="s" direction="in"/></method>
<property name="RegisteredStatusNotifierItems" type="as" access="read"/>
<property name="IsStatusNotifierHostRegistered" type="b" access="read"/>
<property name="ProtocolVersion" type="i" access="read"/>
<signal name="StatusNotifierItemRegistered"><arg type="s"/></signal>
<signal name="StatusNotifierItemUnregistered"><arg type="s"/></signal>
<signal name="StatusNotifierHostRegistered"/></interface></node>`
let isWatcher = false
const emitW = (sig: string, params: any) => { try { bus.emit_signal(null, WATCHER_PATH, WATCHER, sig, params) } catch (e) { print("[tray] emit:", e) } }
const startWatcherMode = () => {
    isWatcher = true
    const iface = Gio.DBusNodeInfo.new_for_xml(WATCHER_XML).interfaces[0]
    try {
        bus.register_object(WATCHER_PATH, iface,
            (_c: any, sender: string, _p: any, _i: any, method: string, params: any, invocation: any) => {
                if (method === "RegisterStatusNotifierItem") {
                    const service = params.deep_unpack()[0]


                    const reg = service.startsWith("/") ? sender + service : service + "/StatusNotifierItem"
                    addItem(reg); emitW("StatusNotifierItemRegistered", new GLib.Variant("(s)", [reg]))
                } else if (method === "RegisterStatusNotifierHost") {
                    emitW("StatusNotifierHostRegistered", new GLib.Variant("()", []))
                }
                invocation.return_value(null)
            },
            (_c: any, _s: any, _p: any, _i: any, prop: string) => {
                if (prop === "RegisteredStatusNotifierItems") return new GLib.Variant("as", items.map(i => i.key))
                if (prop === "IsStatusNotifierHostRegistered") return new GLib.Variant("b", true)
                if (prop === "ProtocolVersion") return new GLib.Variant("i", 0)
                return null
            },
            null as any)
    } catch (e) { print("[tray] register_object:", e) }

    subs.push(bus.signal_subscribe("org.freedesktop.DBus", "org.freedesktop.DBus", "NameOwnerChanged", "/org/freedesktop/DBus", null, Gio.DBusSignalFlags.NONE,
        (_c, _s, _p, _i, _sig, params) => {
            try {
                const [name, , newOwner] = params.deep_unpack()
                if (newOwner === "") for (const it of items.filter(x => x.bus === name)) { removeItem(it.key); emitW("StatusNotifierItemUnregistered", new GLib.Variant("(s)", [it.key])) }
            } catch { }
        }))

    emitW("StatusNotifierHostRegistered", new GLib.Variant("()", []))
}

export const startTray = () => {
    if (started) return
    started = true
    Gio.bus_own_name_on_connection(bus, WATCHER, Gio.BusNameOwnerFlags.NONE,
        () => { if (!isWatcher) startWatcherMode() },
        () => { if (!isWatcher) startHostMode() })
}
