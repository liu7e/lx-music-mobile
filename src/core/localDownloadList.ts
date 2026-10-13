// “本地音乐”列表：自动收录下载目录里的歌曲，可离线播放
import { addListMusics, createUserList, removeListMusics } from '@/core/list'
import listState from '@/store/list/state'
import { getListMusics } from '@/utils/listManage'
import { readMetadata, scanAudioFiles, type MusicMetadataFull } from '@/utils/localMediaMetadata'
import { existsFile } from '@/utils/fs'
import { formatPlayTime2 } from '@/utils/common'
import { checkStoragePermissions } from '@/utils/tools'
import { log } from '@/utils/log'
import { DOWNLOAD_DIR } from '@/core/music/downloadPath'

export const LOCAL_LIST_ID = 'userlist_local_download'

const buildMusicInfo = (filePath: string, metadata: MusicMetadataFull): LX.Music.MusicInfoLocal => ({
  id: filePath,
  name: metadata.name,
  singer: metadata.singer,
  source: 'local',
  interval: formatPlayTime2(metadata.interval),
  meta: {
    albumName: metadata.albumName,
    filePath,
    songId: filePath,
    picUrl: '',
    ext: metadata.ext,
  },
})

const ensureList = async() => {
  if (listState.userList.some(l => l.id == LOCAL_LIST_ID)) return
  await createUserList(0, [{ id: LOCAL_LIST_ID, name: global.i18n.t('local_list_name'), locationUpdateTime: null }])
}

const readMusicInfos = async(paths: string[]) => {
  const list: LX.Music.MusicInfoLocal[] = []
  for (const path of paths) {
    try {
      const info = await readMetadata(path)
      if (info) list.push(buildMusicInfo(path, info))
    } catch (err: any) {
      log.warn(`local list: read metadata failed: ${path} ${err.message}`)
    }
  }
  return list
}

let syncing: Promise<void> | null = null

// 让列表与下载目录保持一致：补上新文件，去掉已被删除的文件
export const syncLocalList = async() => {
  if (syncing) return syncing
  syncing = (async() => {
    if (!await checkStoragePermissions()) return
    if (!await existsFile(DOWNLOAD_DIR)) return
    const files = (await scanAudioFiles(DOWNLOAD_DIR)).filter(f => !f.name.startsWith('.'))
    await ensureList()
    const list = await getListMusics(LOCAL_LIST_ID)
    const listIds = new Set(list.map(m => m.id))
    const filePaths = new Set(files.map(f => f.path))
    const removed = list.filter(m => m.source == 'local' && m.id.startsWith(DOWNLOAD_DIR) && !filePaths.has(m.id)).map(m => m.id)
    if (removed.length) await removeListMusics(LOCAL_LIST_ID, removed)
    const added = await readMusicInfos(files.map(f => f.path).filter(p => !listIds.has(p)))
    if (added.length) await addListMusics(LOCAL_LIST_ID, added, 'top')
  })().catch((err: any) => {
    log.error(`local list: sync failed: ${err.message}`)
  }).finally(() => {
    syncing = null
  })
  return syncing
}
