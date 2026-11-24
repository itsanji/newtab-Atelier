import { openDb, type AtelierDB } from '../data/db';
import { createMenus, onMenuClicked } from './contextMenus';
import { onCommand } from './commands';
import { checkReminders, onNotificationClicked, onReminderAlarm, syncAlarms } from './reminders';

let db: AtelierDB | undefined;
const getDb = () => (db ??= openDb());
const report = (e: unknown) => console.error(e);

// Listeners must be registered synchronously at the top level of the worker.
chrome.runtime.onInstalled.addListener(() => {
  void createMenus().catch(report);
  void checkReminders(getDb()).catch(report);
});
chrome.runtime.onStartup.addListener(() => void checkReminders(getDb()).catch(report));
chrome.alarms.onAlarm.addListener((alarm) => void onReminderAlarm(getDb(), alarm).catch(report));
chrome.notifications.onClicked.addListener((id) => void onNotificationClicked(id).catch(report));
chrome.runtime.onMessage.addListener((message) => {
  if ((message as { type?: string } | null)?.type === 'reminders-changed') void syncAlarms(getDb()).catch(report);
});
chrome.contextMenus.onClicked.addListener((info, tab) => void onMenuClicked(getDb(), info, tab).catch(report));
chrome.commands.onCommand.addListener((command) => void onCommand(getDb(), command).catch(report));
