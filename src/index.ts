export type Options = {
    initialUrl?: Location
    allowHashchange: boolean
    listenHashchange: boolean
}

const DEFAULT_OPTIONS: Options = {
    allowHashchange: true,
    listenHashchange: true,
}

// Why not
export { DEFAULT_OPTIONS }

enum Action {
    forward = "forward",
    back = "back",
    hashchange = "hashchange",
}

export type NavigationEvent = {
    action: Action
    location: URL
    isHashChange: boolean
    stopPropagation?: Function
}

type CreatePromiseResult = {
    promise: Promise<void>
    resolver: Function
}

function createPromise(): CreatePromiseResult {
    let resolver
    return {
        promise: new Promise((resolve, reject) => {
            resolver = resolve
        }),
        resolver
    }
}

class NavKeysController {
    // General purpose options
    readonly options: Options

    // Browser real history
    private originalHistory: History

    // toggle this on when popstate event is espected to happen
    //0 == false
    private ignoreEvent: number

    // keeps track of forward button enable state
    private forwardButtonEnabled: boolean

    // awaiting this ensures that native history events finished it cycle. Also, handles popstate event
    private waitEventTrigger: Function

    // Actual location/url
    private _url: URL

    // Event listeners set
    private listeners: Set<Function>

    // Temporal variables used on event trigger cycle
    private _nextUrl?: URL
    private _disableForward: boolean
    private _enableForward: boolean

    constructor(originalHistory: History = window.history, options?) {
        this.options = { ...DEFAULT_OPTIONS, ...options }
        this.originalHistory = originalHistory
        this.ignoreEvent = 0
        this.forwardButtonEnabled = false
        this.listeners = new Set()
        this._url = new URL(window.location.toString())

        if (this.options.initialUrl) {
            this._url = options.initialLocation
        }

        //Inicializar sistema
        this.initHistory(this._url.href)

        //handles popstate event
        this.waitEventTrigger = this.handleEvent()

        //Used to replace url when triggered event
        this._nextUrl = null
    }

    private initHistory(initialUrl: string) {
        // HISTORY STATES: [ state = {pos: 0 } ]       [ state = {pos: 1 } ]             [ state = {pos: 2 } ]   => the last block can be romeved to disable forward button
        //       USED TO DETECT BACK                  KEEP TEH USER ALLWAYS HERE        USED TO DETECT FORWARD
        // If user goes back: the event handler will detect pos = 0 and take action as back event
        // If user goes forward: the event handler will detect pos = 2 and take action as forward event
        // If user use hash navigation: the event handler will detect pos = undefined and take action as navigate event
        this.originalHistory.replaceState({ pos: 0 }, '', initialUrl)
        this.originalHistory.pushState({ pos: 1 }, '', initialUrl)

        this.originalHistory.scrollRestoration = 'manual'
    }

    async _enableForwardButton() {
        //Prevent handler from doing strange stuff
        this.ignoreEvent++
        //Ensure there are a 3rd block (pos: 2)
        this.originalHistory.pushState({ pos: 2 }, '')
        //Returns to pos:1
        this.originalHistory.back()
        //Wait event call
        await this.waitEventTrigger()
        //Keep track of state
        this.forwardButtonEnabled = true
        //
        this.ignoreEvent--
    }

    async enableForwardButton() {
        if (this.ignoreEvent) {
            this._enableForward = true
        } else {
            await this._enableForwardButton()
        }
    }

    private async _disableForwardButton() {
        //new pushed url
        const href = this.url
        //Prevent handler from doing strange stuff
        this.ignoreEvent++
        //return to pos 1 from pos undefined ==> 2
        this.originalHistory.back()
        //wait back event finish
        await this.waitEventTrigger()
        //set correct url
        this.originalHistory.pushState({ pos: 1 }, '', href.toString())
        //Keeps track of forwardButtonEnabled
        this.forwardButtonEnabled = false
        //
        this.ignoreEvent--
    }

    async disableForwardButton() {
        if (this.ignoreEvent) {
            this._disableForward = true
        } else {
            await this._disableForwardButton()
        }
    }

    get url() {
        return this._url
    }

    set url(url: URL | string) {
        this._url = new URL(url.toString(), this._url)
        if (this.ignoreEvent) {
            this._nextUrl = this._url
        } else {
            //Replace url
            this.originalHistory.replaceState(this.originalHistory.state, '', url.toString())
        }
    }

    private launchEvent(action: Action, customEventData: NavigationEvent): void {
        customEventData.action = action
        const list = Array.from(this.listeners.values())
        let cb = list.pop()
        let next = true
        customEventData.stopPropagation = () => {
            next = false
        }
        while (cb && next) {
            cb(customEventData)
            cb = list.pop()
        }
    }

    public listen(callback: Function) {
        this.listeners.add(callback)
        return () => {
            this.listeners.delete(callback)
        }
    }

    public exit() {
        this.ignoreEvent++
        this.originalHistory.back()
        this.originalHistory.back()
    }

    public get isForwardButtonEnabled() {
        return this.forwardButtonEnabled
    }

    private handleEvent() {
        let { promise: waitEventPromise, resolver: waitEventPromiseResovler }: CreatePromiseResult = createPromise()

        window.addEventListener('popstate', async event => {
            //User triggered event
            const newPos = this.originalHistory.state && this.originalHistory.state.pos
            if (!this.ignoreEvent && newPos != 1) {
                const customEventData: NavigationEvent = { location: new URL(this.url.toString()), isHashChange: false, action: null }

                // Push hash
                if (!this.originalHistory.state || this.originalHistory.state.pos == undefined || this.originalHistory.state.pos == null) {
                    //Prevent handler from doing strange stuff
                    this.ignoreEvent++

                    if (this.options.allowHashchange) {
                        //new pushed url
                        this.url = window.location.href
                        //The event new location is different on navigate event and only on navigate event
                        customEventData.location = new URL(this.url)
                    }

                    //return to pos 1 from pos undefined ==> 2
                    this.originalHistory.back()
                    //wait back event finish
                    await waitEventTrigger()

                    //Actually the only way this event is trigerred by popstate is by a hashchange
                    customEventData.isHashChange = true

                    if (this.options.listenHashchange) {
                        //Launch event
                        this.launchEvent(Action.hashchange, customEventData)
                    }

                    // Disable forward if neccesary
                    if (!this.forwardButtonEnabled) this.disableForwardButton()

                    //end prevent handler from doing strange stuff
                    this.ignoreEvent--
                }
                //Forward event
                else if (this.originalHistory.state.pos == 2) {
                    this.ignoreEvent++
                    this.originalHistory.back()
                    //Wait back event finish
                    await waitEventTrigger()
                    //Launch event
                    this.launchEvent(Action.forward, customEventData)
                    this.ignoreEvent--
                }
                //Backward event
                else if (this.originalHistory.state.pos == 0) {
                    //Use last known location, don't change url
                    const href = this._url.href
                    //this.originalHistory.pushState ( back state )
                    this.originalHistory.pushState({ pos: 1 }, '', href)
                    // Reenable forward button
                    if (this.forwardButtonEnabled) this.enableForwardButton()
                    //Launch event
                    this.launchEvent(Action.back, customEventData)
                }
                //set correct url
                this.originalHistory.replaceState(this.originalHistory.state, '', this.url.toString())
                //Reset value
                this._nextUrl = null
                //Save new location
                if (this._disableForward) {
                    await this._disableForwardButton()
                    this._disableForward = false
                } else if (this._enableForward) {
                    await this._enableForwardButton()
                    this._enableForward = false
                }
            }

            waitEventPromiseResovler(event)
            const { promise, resolver } = createPromise()
            waitEventPromise = promise
            waitEventPromiseResovler = resolver
        })

        function waitEventTrigger() {
            const promise = waitEventPromise
            const resolver = waitEventPromiseResovler

            //Resolve promise in 100 ms if for some reaason doesn't get resolved by event (ITS NECESARY ON IE)
            let resolved = false
            promise.then(() => { resolved = true })
            setTimeout(function () {
                if (!resolved) resolver()
            }, 100)
            //////

            return promise
        }

        return waitEventTrigger
    }

}

export default NavKeysController
