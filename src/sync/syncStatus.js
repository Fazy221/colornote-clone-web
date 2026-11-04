import { create } from 'zustand';

// Where sync is, for the status icon:
//   'off'        not signed in, or stopped
//   'waiting'    no connection yet; tries again when the browser is back online, or in a minute
//   'connecting' catching up with the cloud
//   'live'       caught up, and listening for changes from the phone
export const useSyncStatus = create(() => ({ phase: 'off' }));

export const setSyncPhase = (phase) => useSyncStatus.setState({ phase });
