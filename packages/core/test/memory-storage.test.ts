import { createMemoryStorage } from '../src'
import { describeScanStorageContract } from '../src/testing'

describeScanStorageContract('memory', () => {
  const storage = createMemoryStorage()
  return { storage, putScheduler: storage.putScheduler, trackChannel: storage.trackChannel }
})
