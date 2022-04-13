import NavKeysController from ".";

declare global {
    interface Window { NavKeysController: any; }
}

window.NavKeysController = NavKeysController