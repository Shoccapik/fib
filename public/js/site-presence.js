(() => {
    const userId = document.currentScript.dataset.userId
    if(!userId) return

    const storageKey = `fib-site-tabs-${userId}`
    const tabIdKey = `fib-site-tab-id-${userId}`
    const staleAfter = 2 * 60 * 1000
    let tabId = sessionStorage.getItem(tabIdKey)
    if(!tabId){
        tabId = typeof crypto.randomUUID === 'function'
            ? crypto.randomUUID()
            : `${Date.now()}-${Math.random().toString(36).slice(2)}`
        sessionStorage.setItem(tabIdKey, tabId)
    }

    let navigatingWithinSite = false

    function readTabs(){
        try {
            const tabs = JSON.parse(localStorage.getItem(storageKey) || '{}')
            const now = Date.now()
            for(const [id, lastSeen] of Object.entries(tabs)){
                if(now - lastSeen > staleAfter) delete tabs[id]
            }
            return tabs
        } catch(error) {
            console.error('Impossible de lire les onglets actifs du site:', error)
            return {}
        }
    }

    function writeTabs(tabs){
        try {
            localStorage.setItem(storageKey, JSON.stringify(tabs))
            return true
        } catch(error) {
            console.error('Impossible d’enregistrer les onglets actifs du site:', error)
            return false
        }
    }

    function registerTab(){
        const tabs = readTabs()
        tabs[tabId] = Date.now()
        writeTabs(tabs)
    }

    function isInternalNavigation(url){
        return url.origin === window.location.origin && url.pathname !== '/logout'
    }

    document.addEventListener('click', event => {
        const link = event.target.closest('a[href]')
        if(!link || link.target === '_blank' || link.hasAttribute('download')) return

        try {
            const url = new URL(link.href, window.location.href)
            navigatingWithinSite = isInternalNavigation(url) &&
                (url.pathname !== window.location.pathname || url.search !== window.location.search)
        } catch(error) {
            navigatingWithinSite = false
        }
        if(navigatingWithinSite) setTimeout(()=>{ navigatingWithinSite = false }, 1000)
    }, true)

    document.addEventListener('submit', event => {
        const form = event.target
        if(form.target === '_blank') return

        try {
            navigatingWithinSite = isInternalNavigation(new URL(form.action || window.location.href, window.location.href))
        } catch(error) {
            navigatingWithinSite = false
        }
        if(navigatingWithinSite) setTimeout(()=>{ navigatingWithinSite = false }, 1000)
    }, true)

    registerTab()
    fetch('/service/enter', {method: 'POST', keepalive: true})
        .then(response => {
            if(!response.ok) console.error('Impossible de signaler la présence sur le site')
        })
        .catch(error => console.error('Erreur de présence du site:', error))

    const heartbeat = setInterval(registerTab, 15000)

    window.addEventListener('pagehide', event => {
        if(event.persisted) return

        clearInterval(heartbeat)
        const tabs = readTabs()
        delete tabs[tabId]
        const storageAvailable = writeTabs(tabs)
        const anotherTabIsOpen = Object.keys(tabs).length > 0

        if(navigatingWithinSite || anotherTabIsOpen) return

        if(!storageAvailable || !anotherTabIsOpen){
            navigator.sendBeacon('/service/leave')
        }
    })
})()
