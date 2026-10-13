import { downloadFile, existsFile, mkdir, moveFile, scanFile, temporaryDirectoryPath, unlink } from '@/utils/fs'
import { requestStoragePermission, toast } from '@/utils/tools'
import { writeLyric, writeMetadata, writePic } from '@/utils/localMediaMetadata'
import { log } from '@/utils/log'
import { getPicUrl, getLyricInfo } from './online'
import { handleGetOnlineMusicUrl } from './utils'
import { DOWNLOAD_DIR, getDownloadFileName, getDownloadedFilePath } from './downloadPath'
import { syncLocalList } from '@/core/localDownloadList'

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

const downloadOne = async(musicInfo: LX.Music.MusicInfoOnline, isRetry = false): Promise<'done' | 'exists'> => {
  // 已下载过就不再去取链接，省一次请求
  if (await getDownloadedFilePath(musicInfo)) return 'exists'
  const { url, quality } = await handleGetOnlineMusicUrl({
    musicInfo,
    isRefresh: true,
    allowToggleSource: true,
    onToggleSource: () => {},
  })
  const name = getDownloadFileName(musicInfo)
  const ext = getExt(quality)
  const filePath = `${DOWNLOAD_DIR}/${name}.${ext}`
  if (await existsFile(filePath)) return 'exists'
  // 先下到临时文件再改名，避免中断后留下不完整的文件（保留扩展名，写标签时要靠它识别格式）
  const tempPath = `${DOWNLOAD_DIR}/.${name}.downloading.${ext}`
  try {
    await runDownload(url, tempPath)
  } catch (err) {
    void unlink(tempPath)
    if (isRetry) throw err
    // 网络抖动或链接过期时，重新获取链接再试一次
    return downloadOne(musicInfo, true)
  }
  await writeTags(musicInfo, tempPath)
  await moveFile(tempPath, filePath)
  void scanFile(filePath).catch(() => {})
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
  queue = queue.then(async() => {
    await mkdir(DOWNLOAD_DIR).catch(() => {})
    let success = 0
    let failed = 0
    for (const musicInfo of musics) {
      try {
        await downloadOne(musicInfo)
        success++
      } catch (err: any) {
        failed++
        log.error(`download ${musicInfo.name} failed: ${err.message}`)
        toast(global.i18n.t('download_failed', { name: musicInfo.name, msg: err.message }), 'long')
      }
    }
    void syncLocalList()
    // 只在有失败时提示，成功的歌会自动出现在「本地音乐」列表里
    if (musics.length > 1 && failed) toast(global.i18n.t('download_finish', { success, failed }), 'long')
  })
  return queue
}
