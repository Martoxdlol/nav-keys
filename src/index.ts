type Options = {

}

const DEFAULT_OPTIONS: Options = {

}

enum Action {
    forward = "forward",
    back = "back",
    hashchange = "hashchange",

}

type CustomEventData = {
    action: Action
    lastLocation: Location
    location: Location
    isHashChange: boolean
    stopPropagation?: Function
}

type CreatePromiseResult = {
    promise: Promise<any>
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
    //General purpose options
    readonly options: Options

    //Browser real history
    private originalHistory: History

    //Store last location info
    private lastLocation: Location

    //toggle this on when popstate event is espected to happen
    //0 == false
    private ignoreEvent: number

    //keeps track of forward button enable state
    private forwardButtonEnabled: boolean

    //awaiting this ensures that native history events finished it cycle. Also, handles popstate event
    private waitEventTrigger: Function

    // Event listeners set
    private listeners: Set<Function>

    // Temporal variables used on event trigger cycle
    private _nextUrl?: URL
    private _disableForward: boolean

    constructor(originalHistory: History = window.history, options) {
        this.options = { ...DEFAULT_OPTIONS, ...options }
        this.originalHistory = originalHistory
        this.lastLocation = { ...location }
        this.ignoreEvent = 0
        this.forwardButtonEnabled = false
        this.listeners = new Set()

        //Inicializar sistema
        this.initHistory()

        //handles popstate event
        this.waitEventTrigger = this.handleEvent()

        //Used to replace url when triggered event
        this._nextUrl = null
    }

    private initHistory() {
        // HISTORY STATES: [ state = {pos: 0 } ]       [ state = {pos: 1 } ]             [ state = {pos: 2 } ]   => the last block can be romeved to disable forward button
        //       USED TO DETECT BACK                  KEEP TEH USER ALLWAYS HERE        USED TO DETECT FORWARD
        // If user goes back: the event handler will detect pos = 0 and take action as back event
        // If user goes forward: the event handler will detect pos = 2 and take action as forward event
        // If user use hash navigation: the event handler will detect pos = undefined and take action as navigate event
        this.originalHistory.replaceState({ pos: 0 }, '')
        this.originalHistory.pushState({ pos: 1 }, '')
    }

    async enableForwardButton() {
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
        if (this._nextUrl) return new URL(this._nextUrl.toString(), location.href.toString())
        else return new URL(location.href)
    }

    set url(url: URL | string) {
        if (this.ignoreEvent) {
            this._nextUrl = new URL(url.toString(), this.url.toString())
        } else {
            //Replace url
            this.originalHistory.replaceState(this.originalHistory.state, '', url.toString())
            //Update saved location
            this.lastLocation = { ...location }
        }
    }

    private launchEvent(action: Action, customEventData: CustomEventData): void {
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

    private handleEvent() {
        let { promise: waitEventPromise, resolver: waitEventPromiseResovler }: CreatePromiseResult = createPromise()

        window.addEventListener('popstate', async event => {
            //User triggered event
            const newPos = this.originalHistory.state && this.originalHistory.state.pos
            if (!this.ignoreEvent && newPos != 1) {
                const customEventData: CustomEventData = { lastLocation: { ...this.lastLocation }, location: { ...location }, isHashChange: false, action: null }

                //Push state / navigate event / hash change
                if (!this.originalHistory.state || this.originalHistory.state.pos == undefined || this.originalHistory.state.pos == null) {
                    //Prevent handler from doing strange stuff
                    this.ignoreEvent++
                    //new pushed url
                    this.url = location.href
                    //return to pos 1 from pos undefined ==> 2
                    this.originalHistory.back()
                    //wait back event finish
                    await waitEventTrigger()

                    //Actually the only way this event is trigerred by popstate is by a hashchange
                    customEventData.isHashChange = true

                    //Launch event
                    this.launchEvent(Action.hashchange, customEventData)

                    // Disable forward if neccesary
                    if (!this.forwardButtonEnabled) this.disableForwardButton()

                    //end prevent handler from doing strange stuff
                    this.ignoreEvent--
                    //The event new location is different on navigate event and only on navigate event
                    customEventData.location = { ...location }
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
                    const href = this.lastLocation.href
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
                this.lastLocation = { ...location }

                if (this._disableForward) {
                    await this._disableForwardButton()
                    this._disableForward = false
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

declare global {
    interface Window { NavKeysController: any; }
}

if (process.env.NODE_ENV === 'development') {
    window.NavKeysController = NavKeysController
}

export default NavKeysController
