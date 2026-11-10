function e(e){return e.replace(/```[\s\S]*?(```|$)/g,`
`).split(`
`).map(e=>e.replace(/^\s*(#{1,6}\s+|>\s*|[-*+]\s+(\[[ xX]\]\s+)?|\d+\.\s+)/,``).trim()).filter(e=>e&&!/^\|.*\|$/.test(e)&&!/^[-:| ]+$/.test(e)).join(` `).replace(/\[([^\]]*)\]\([^)]*\)/g,`$1`).replace(/[*_~`]+/g,``).replace(/\s+/g,` `).trim()}export{e as t};