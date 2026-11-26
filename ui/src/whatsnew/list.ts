import WHATS_NEW from "../../../WHATSNEW.md?raw"

import { readNotes } from "~/whatsnew/notes"

export const NOTES = readNotes(WHATS_NEW)
