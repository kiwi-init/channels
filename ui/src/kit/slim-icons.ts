const ATTRS = /\{[^{}]*\}/g
const ROUND = /, stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round", strokeWidth: "1\.5"(?=, key: )/
const KEY = /, key: "\d+"/

export const slimIcon = (code: string): string => code.replace(ATTRS, (attrs) => (attrs.includes("fill: ") ? attrs : attrs.replace(ROUND, "")).replace(KEY, ""))
