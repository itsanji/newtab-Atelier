import { openDb, type AtelierDB } from '../data/db';
import { createMenus, onMenuClicked } from './contextMenus';
import { onCommand } from './commands';

let db: AtelierDB | undefined;
const getDb = () => (db ??= openDb());
const report = (e: unknown) => console.error(e);

// Listeners must be registered synchronously at the top level of the worker.
chrome.runtime.onInstalled.addListener(() => void createMenus().catch(report));
chrome.contextMenus.onClicked.addListener((info, tab) => void onMenuClicked(getDb(), info, tab).catch(report));
chrome.commands.onCommand.addListener((command) => void onCommand(getDb(), command).catch(report));
