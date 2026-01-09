// In-memory store for quiz announcements
// Supports multiple simultaneous announcements displayed as stacked banners

export const announcementStore = {
    announcements: [], // Array of { id, message, type, timestamp, expiresAt, persistent }
    history: [], // Keep last 20 announcements for reference
};

/**
 * Publish a new announcement (adds to the list, doesn't replace)
 * @param {string} message - The announcement message
 * @param {string} type - Type of announcement: 'info', 'warning', 'success', 'urgent'
 * @param {number} durationSeconds - How long the announcement should be active (default: 30 seconds)
 * @param {boolean} persistent - If true, users cannot dismiss this locally (default: false)
 */
export function publishAnnouncement(message, type = 'info', durationSeconds = 30, persistent = false) {
    const now = Date.now();
    const announcement = {
        id: `ann_${now}_${Math.random().toString(36).substr(2, 5)}`,
        message,
        type,
        timestamp: now,
        expiresAt: now + (durationSeconds * 1000),
        persistent: !!persistent, // LB-06: Persistent announcements can't be dismissed by users
    };

    // Add to active announcements
    announcementStore.announcements.push(announcement);

    // Add to history (keep last 20)
    announcementStore.history.unshift(announcement);
    if (announcementStore.history.length > 20) {
        announcementStore.history = announcementStore.history.slice(0, 20);
    }

    console.log(`[Announcement] Published: "${message}" (type: ${type}, expires in ${durationSeconds}s, persistent: ${persistent})`);
    return announcement;
}

/**
 * Get all active announcements (filters out expired ones)
 * Returns array of active announcements
 */
export function getActiveAnnouncements() {
    const now = Date.now();

    // Filter out expired announcements
    announcementStore.announcements = announcementStore.announcements.filter(
        ann => now <= ann.expiresAt
    );

    return announcementStore.announcements;
}

/**
 * Get the current active announcement (for backward compatibility)
 * Returns the most recent active announcement or null
 */
export function getCurrentAnnouncement() {
    const active = getActiveAnnouncements();
    return active.length > 0 ? active[active.length - 1] : null;
}

/**
 * Clear a specific announcement by ID
 * @param {string} id - The announcement ID to clear
 */
export function clearAnnouncementById(id) {
    const initialLength = announcementStore.announcements.length;
    announcementStore.announcements = announcementStore.announcements.filter(
        ann => ann.id !== id
    );
    const removed = initialLength - announcementStore.announcements.length;
    console.log(`[Announcement] Cleared announcement ${id}: ${removed > 0 ? 'success' : 'not found'}`);
    return removed > 0;
}

/**
 * Clear all announcements
 */
export function clearAllAnnouncements() {
    const count = announcementStore.announcements.length;
    announcementStore.announcements = [];
    console.log(`[Announcement] Cleared all ${count} announcement(s)`);
    return count;
}

/**
 * Clear the current/latest announcement (for backward compatibility)
 */
export function clearAnnouncement() {
    if (announcementStore.announcements.length > 0) {
        const last = announcementStore.announcements.pop();
        console.log(`[Announcement] Cleared latest announcement: ${last.id}`);
        return true;
    }
    return false;
}

/**
 * Get announcement history
 */
export function getAnnouncementHistory() {
    return announcementStore.history;
}

/**
 * Reset all announcements
 */
export function resetAnnouncements() {
    announcementStore.announcements = [];
    announcementStore.history = [];
    console.log('[Announcement] Reset all announcements');
}
