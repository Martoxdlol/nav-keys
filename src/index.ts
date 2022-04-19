/*
How it works:

Native browser history will have three positions: [state: {pos:0}], [state: {pos:1}], [state: {pos:2}] (the last one is optional)
Normally it will stay always on {pos:1}, when user click back button it will trigger a 'popstate' event and the new current state will be {pos:0}
because of that I can know the user clicked back.
If user click forward button it will trigger a 'popstate' event and the new current state will be {pos:2}

Brwoser native history states:
{pos: 0}, {pos: 1}, {pos: 2}
    Normal state^

{pos: 0}, {pos: 1}, {pos: 2}
      ^ On back

{pos: 0}, {pos: 1}, {pos: 2}
                On forward^ 

{pos: 0}, {pos: 1}
      Forwawrd disabled ^

After each event, it will return to normal state
*/

export type NavKeysOptions = {
    initialUrl?: string
    /* It calls last added listener first if enabled */
    callListenersAsStack?: boolean
    allowHashchange?: boolean
    listenHashchange?: boolean
}


export const DEFAULT_OPTIONS: NavKeysOptions = {
    allowHashchange: false,
    listenHashchange: true,
    callListenersAsStack: false,
}

export enum Action {
    forward = 'forward',
    back = 'back',
    hashchange = 'hashchange',
}

export type NavKeyEvent = {
    action: Action,
    url: URL,
}

export default class NavKeysController {
    options: NavKeysOptions
    nativeHistory: History
    private _url: string

    // required state of forward button
    private _forwardButtonEnabledNext: boolean
    // real state of forward button
    private _forwardButtonEnabled: boolean
    // Queue of events
    private eventQueue: Array<NavKeyEvent> = []

    private listeners: Set<Function> = new Set()
    // Event handled with bind(this)
    private eventHandlerBinded: any

    constructor(history?: History, options?: NavKeysOptions) {
        options = { ...DEFAULT_OPTIONS, ...options }
        this.options = options
        this.nativeHistory = history || window.history
        this._url = window.location.href
        if (options.initialUrl) {
            // Complete the route if given initialUrl was not a full url
            this._url = (new URL(options.initialUrl, this._url)).href
        }

        // Initialize history states
        initHistory(this.nativeHistory, this._url)

        // We use 'hashchange' to ensure it works on IE
        window.addEventListener("hashchange", e => {
            const u = window.location.href
            if (options.allowHashchange) {
                this._url = u
            }
            this.nativeHistory.replaceState({ pos: 2 }, '', this._url)
            this._lastPos = 2
            this.nativeHistory.back()
            this._preventBackEvent++
            this.nativeHistory.back()
            if (options.listenHashchange) {
                this.eventQueue.push({ action: Action.hashchange, url: new URL(u) })
            }
        }, false)

        this.eventHandlerBinded = this.handleEvent.bind(this)
        window.addEventListener('popstate', this.eventHandlerBinded)
    }

    private _lastPos: number = 1
    private _preventBackEvent: number = 0

    private handleEvent(event: PopStateEvent) {
        const state = event.state || {}
        const pos = state.pos ?? null

        if (pos === 0) {
            // Back click

            // Always required actions, (return to pos:1 and if neccessary disable forward)
            this.nativeHistory.replaceState(state, '', this._url)
            this._lastPos = 0

            if (this._forwardButtonEnabledNext) {
                // Allow keep forward button enable
                this.nativeHistory.forward()
            } else {
                // Disable forward button
                this.nativeHistory.pushState({ pos: 1 }, '', this._url)
                this._lastPos = 1
                this._forwardButtonEnabled = false
            }

            // Optional, emit event
            if (this._preventBackEvent === 0) {
                this.eventQueue.push({ action: Action.back, url: new URL(this._url) })
            } else {
                this._preventBackEvent--
            }

            if (!this._forwardButtonEnabledNext) this.emitEvents()

        } else if (pos === 2) {
            // Forward clicked
            this._lastPos = 2
            this.nativeHistory.back()

            this.eventQueue.push({ action: Action.forward, url: new URL(this._url) })

        } else if (pos === 1) {
            // Set correct url
            this.nativeHistory.replaceState(state, '', this._url)

            // Previous position was 1 (hashchange or forward)
            if (this._lastPos === 2 && (!this._forwardButtonEnabledNext && this._forwardButtonEnabled)) {
                // this makes that back event will be only used to disable forward
                this._preventBackEvent++
                this.nativeHistory.back()

            } else if (this._lastPos === 0 && (this._forwardButtonEnabledNext && !this._forwardButtonEnabled)) {
                // Enable forward button
                this.nativeHistory.pushState({ pos: 2 }, '', this._url)
                this._lastPos = 1
                this.nativeHistory.back()
                this._forwardButtonEnabled = true

            } else if (this._lastPos === 0) {
                this._lastPos = 1
            } else if (this._lastPos === 2) {
                this._lastPos = 1
            }
            if (this._lastPos === 1) {
                this.emitEvents()
            }
        }
    }

    emitEvents() {
        // Emit events
        for (const event of this.eventQueue) {
            const listenersList = Array.from(this.listeners.values())
            if (this.options.callListenersAsStack) listenersList.reverse()
            listenersList.forEach(l => l(event))
        }
        this.eventQueue = []
    }

    enableForwardButton() {
        if (this._forwardButtonEnabledNext) return
        this._forwardButtonEnabledNext = true
        if (this._lastPos == 1 && !this._forwardButtonEnabled) {
            this._preventBackEvent++
            this.nativeHistory.back()
        }
    }

    disableForwardButton() {
        if (!this._forwardButtonEnabledNext) return
        this._forwardButtonEnabledNext = false
        if (this._lastPos == 1 && this._forwardButtonEnabled) {
            this._preventBackEvent++
            this.nativeHistory.back()
        }
    }

    set url(url: string | URL) {
        this._url = (new URL(url.toString(), this._url)).href
        if (this._lastPos === 1) {
            this.nativeHistory.replaceState(this.nativeHistory.state, '', this._url)
        }
    }

    get url() {
        return this._url
    }

    listen(listener: Function) {
        this.listeners.add(listener)
        return () => this.listeners.delete(listener)
    }

    exit() {
        window.removeEventListener('popstate', this.eventHandlerBinded)
        this.nativeHistory.back()
        this.nativeHistory.back()
        this.nativeHistory.back()
    }

    get isForwardButtonEnabled() {
        return !!this._forwardButtonEnabledNext
    }
}

function initHistory(history: History, url: string) {
    history.replaceState({ pos: 0 }, '', url)
    history.pushState({ pos: 1 }, '', url)
}