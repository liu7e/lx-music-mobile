import { downloadFile, existsFile, externalStorageDirectoryPath, mkdir, moveFile, temporaryDirectoryPath, unlink } from '@/utils/fs'
import { filterFileName } from '@/utils/common'
import { formatMusicName, requestStoragePermission, toast } from '@/utils/tools'
import { writeLyric, writeMetadata, writePic } from '@/utils/localMediaMetadata'
import settingState from '@/store/setting/state'
import { log } from '@/utils/log'
import { getPicUrl, getLyricInfo } from './online'
import { handleGetOnlineMusicUrl } from './utils'

export const DOWNLOAD_DIR = `${externalStorageDirectoryPath}/Music/LxMusic`

const getExt = (quality: LX.Quality): LX.Download.FileExt => {
  switch (quality) {
    case 'flac':
    case 'flac24bit':
      return 'flac'
    default:
      return 'mp3'
  }
}

const runDownload = async(url: string, path: string) => {
  const { promise } = downloadFile(url, path, { connectionTimeout: 20000, readTimeout: 30000 })
  const res = await promise
  if (res.statusCode < 200 || res.statusCode >= 300) throw new Error(`HTTP ${res.statusCode}`)
}

// 写入标签信息（歌名、歌手、专辑、封面、歌词），失败不影响已下载的文件
const writeTags = async(musicInfo: LX.Music.MusicInfoOnline, filePath: string) => {
  try {
    await writeMetadata(filePath, {
      name: musicInfo.name,
      singer: musicInfo.singer,
      albumName: musicInfo.meta.albumName ?? '',
    })
  } catch (err: any) {
    log.warn(`download: write metadata failed: ${err.message}`)
  }
  try {
    const picUrl = await getPicUrl({ musicInfo, isRefresh: false, allowToggleSource: false })
    if (picUrl) {
      const picPath = `${temporaryDirectoryPath}/download_pic_${Date.now()}`
      await runDownload(picUrl, picPath)
      await writePic(filePath, picPath)
      void unlink(picPath)
    }
  } catch (err: any) {
    log.warn(`download: write pic failed: ${err.message}`)
  }
  try {
    const lyricInfo = await getLyricInfo({ musicInfo, isRefresh: false, allowToggleSource: false })
    if (lyricInfo.lyric) await writeLyric(filePath, lyricInfo.lyric)
  } catch (err: any) {
    log.warn(`download: write lyric failed: ${err.message}`)
  }
}

const downloadOne = async(musicInfo: LX.Music.MusicInfoOnline) => {
  const { url, quality } = await handleGetOnlineMusicUrl({
    musicInfo,
    isRefresh: true,
    allowToggleSource: true,
    onToggleSource: () => {},
  })
  const name = filterFileName(formatMusicName(settingState.setting['download.fileName'], musicInfo.name, musicInfo.singer))
  const ext = getExt(quality)
  const filePath = `${DOWNLOAD_DIR}/${name}.${ext}`
  if (await existsFile(filePath)) return 'exists'
  // 先下到临时文件再改名，避免中断后留下不完整的文件（保留扩展名，写标签时要靠它识别格式）
  const tempPath = `${DOWNLOAD_DIR}/.${name}.downloading.${ext}`
  try {
    await runDownload(url, tempPath)
  } catch (err) {
    void unlink(tempPath)
    throw err
  }
  await writeTags(musicInfo, tempPath)
  await moveFile(tempPath, filePath)
  return 'done'
}

let queue: Promise<void> = Promise.resolve()

export const downloadMusics = async(list: LX.Music.MusicInfo[]) => {
  const musics = list.filter((m): m is LX.Music.MusicInfoOnline => m.source != 'local')
  if (!musics.length) {
    toast(global.i18n.t('download_local_tip'))
    return
  }
  const granted = await requestStoragePermission()
  if (!granted) {
    toast(global.i18n.t('download_permission_tip'), 'long')
    return
  }
  toast(global.i18n.t('download_start', { num: musics.length }))
  queue = queue.then(async() => {
    await mkdir(DOWNLOAD_DIR).catch(() => {})
    let success = 0
    let failed = 0
    for (const musicInfo of musics) {
      try {
        const result = await downloadOne(musicInfo)
        success++
        if (musics.length == 1) {
          toast(global.i18n.t(result == 'exists' ? 'download_exists' : 'download_success', { name: musicInfo.name }), 'long')
        }
      } catch (err: any) {
        failed++
        log.error(`download ${musicInfo.name} failed: ${err.message}`)
        toast(global.i18n.t('download_failed', { name: musicInfo.name, msg: err.message }), 'long')
      }
    }
    if (musics.length > 1) toast(global.i18n.t('download_finish', { success, failed }), 'long')
  })
  return queue
}
