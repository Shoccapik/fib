const urlPattern = /(?:https?:\/\/|www\.)[^\s<>"']+/gi
const trailingPunctuation = /[.,!?;:]$/

function isHttpUrl(value){
    try {
        const url = new URL(value)
        return (url.protocol === "http:" || url.protocol === "https:") && Boolean(url.hostname)
    } catch(error) {
        return false
    }
}

function googleDocsPdfUrl(value){
    try {
        const url = new URL(value)
        if(url.hostname !== "docs.google.com") return null

        const documentPath = url.pathname.match(/^\/document\/(?:u\/\d+\/)?d\/([a-zA-Z0-9_-]+)(?:\/|$)/)
        if(!documentPath) return null

        return `https://docs.google.com/document/d/${documentPath[1]}/export?format=pdf`
    } catch(error) {
        return null
    }
}

function splitReportContent(content){
    const text = String(content || "")
    const segments = []
    let lastIndex = 0

    for(const match of text.matchAll(urlPattern)){
        const urlStart = match.index
        let url = match[0]
        let punctuation = ""

        while(trailingPunctuation.test(url)){
            punctuation = url.slice(-1) + punctuation
            url = url.slice(0, -1)
        }

        while(url.endsWith(")") && (url.match(/\(/g) || []).length < (url.match(/\)/g) || []).length){
            punctuation = ")" + punctuation
            url = url.slice(0, -1)
        }

        const href = /^www\./i.test(url) ? `https://${url}` : url
        if(!isHttpUrl(href)){
            continue
        }

        if(urlStart > lastIndex){
            segments.push({text: text.slice(lastIndex, urlStart)})
        }
        const pdfUrl = googleDocsPdfUrl(href)
        segments.push({
            text: url,
            url: pdfUrl || href,
            isGoogleDoc: Boolean(pdfUrl)
        })
        if(punctuation) segments.push({text: punctuation})
        lastIndex = urlStart + match[0].length
    }

    if(lastIndex < text.length || segments.length === 0){
        segments.push({text: text.slice(lastIndex)})
    }

    return segments
}

module.exports = splitReportContent
