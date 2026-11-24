import { getActiveDb } from '../account/activeDb';
import { createMenus, onMenuClicked } from './contextMenus';
import { onCommand } from './commands';
import { notify } from './notify';
import { registerSync } from '../sync/schedule';
import { checkReminders, onNotificationClicked, onReminderAlarm, syncAlarms } from './reminders';

const report = (e: unknown) => console.error(e);
/** A save the user asked for failed: log it and tell them. */
const saveFailed = (e: unknown) => {
  report(e);
  notify("Couldn't save this page");
};

// Listeners must be registered synchronously at the top level of the worker.
chrome.runtime.onInstalled.addListener(() => {
  void createMenus().catch(report);
  void getActiveDb().then(checkReminders).catch(report);
});
chrome.runtime.onStartup.addListener(() => void getActiveDb().then(checkReminders).catch(report));
chrome.alarms.onAlarm.addListener((alarm) => void getActiveDb().then((db) => onReminderAlarm(db, alarm)).catch(report));
chrome.notifications.onClicked.addListener((id) => void onNotificationClicked(id).catch(report));
chrome.runtime.onMessage.addListener((message) => {
  if ((message as { type?: string } | null)?.type === 'reminders-changed') void getActiveDb().then(syncAlarms).catch(report);
});
chrome.contextMenus.onClicked.addListener((info, tab) => void getActiveDb().then((db) => onMenuClicked(db, info, tab)).catch(saveFailed));
chrome.commands.onCommand.addListener((command) => void getActiveDb().then((db) => onCommand(db, command)).catch(saveFailed));
registerSync();
