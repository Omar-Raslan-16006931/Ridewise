// Ridewise background check (runs outside the web view, even when the app is closed).
// iOS decides when it runs. It asks the server for rides created since this phone
// last looked and shows a local notification for each one.

var STATE_KEY = "ridewise_bg_state";

function readState() {
  try {
    var stored = CapacitorKV.get(STATE_KEY);
    return stored && stored.value ? JSON.parse(stored.value) : null;
  } catch (err) {
    return null;
  }
}

function notificationId(tripId) {
  var hash = 0;
  for (var i = 0; i < tripId.length; i++) {
    hash = (hash * 31 + tripId.charCodeAt(i)) % 2000000000;
  }
  return hash + 1;
}

// Sent by the app whenever it loads rides: which space to watch and what was already seen.
addEventListener("syncState", function (resolve, reject, args) {
  try {
    if (!args || !args.groupCode) {
      CapacitorKV.remove(STATE_KEY);
    } else {
      CapacitorKV.set(
        STATE_KEY,
        JSON.stringify({ apiBase: args.apiBase, groupCode: args.groupCode, lastSeen: args.lastSeen })
      );
    }
    resolve();
  } catch (err) {
    reject(err);
  }
});

// Fired by iOS background refresh.
addEventListener("checkRides", async function (resolve, reject) {
  try {
    var state = readState();
    if (!state || !state.groupCode || !state.apiBase) {
      resolve();
      return;
    }

    var url = state.apiBase + "/api/trips/recent?since=" + encodeURIComponent(state.lastSeen || "");
    var response = await fetch(url, { headers: { "x-ridewise-group-code": state.groupCode } });
    if (!response.ok) {
      resolve();
      return;
    }
    var data = await response.json();
    var trips = (data && data.trips) || [];

    if (trips.length > 0) {
      var shown = trips.slice(-4);
      var notifications = shown.map(function (trip, index) {
        return {
          id: notificationId(trip.id),
          title: trip.title,
          body: trip.body,
          scheduleAt: new Date(Date.now() + 1000 + index * 1000),
          sound: "default",
          threadIdentifier: "ridewise-rides",
        };
      });
      if (trips.length > shown.length) {
        notifications.unshift({
          id: 1999999999,
          title: "Ridewise",
          body: trips.length + " new rides since you last opened the app",
          scheduleAt: new Date(Date.now() + 500),
          threadIdentifier: "ridewise-rides",
        });
      }
      CapacitorNotifications.schedule(notifications);
      state.lastSeen = trips[trips.length - 1].created_at;
      CapacitorKV.set(STATE_KEY, JSON.stringify(state));
    }
    resolve();
  } catch (err) {
    reject(err);
  }
});
