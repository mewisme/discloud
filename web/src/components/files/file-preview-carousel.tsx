"use client"

import { FileIcon } from "lucide-react"
import { useRouter } from "next/navigation"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { FilePreview } from "@/components/files/file-preview"
import { useUserConfig } from "@/components/settings/user-config-context"
import { Carousel, type CarouselApi, CarouselContent, CarouselItem, CarouselNext, CarouselPrevious } from "@/components/ui/carousel"
import { Spinner } from "@/components/ui/spinner"
import { filePreviewKind } from "@/lib/files/preview"
import { clearPreviewPreloadWindow, setPreviewPreloadWindow } from "@/lib/files/preview-preload"
import { cn } from "@/lib/utils"

const infoAutoHideMs = 2200

export type PreviewCarouselFile = {
  id: string
  name: string
  size: number
  chunkSize?: number
  mimeType: string
  category?: string
}

export function FilePreviewCarousel({
  currentFile,
  files,
  routeBase,
  collectionId,
}: {
  currentFile: PreviewCarouselFile
  files: readonly PreviewCarouselFile[]
  routeBase: string
  collectionId?: string
}) {
  const router = useRouter()
  const { config } = useUserConfig()
  const preloadOwnerRef = useRef(
    Symbol("file-preview-carousel"),
  )
  const [api, setApi] = useState<CarouselApi>()
  const [infoVisible, setInfoVisible] =
    useState(true)
  const navigatingToRef =
    useRef<string | undefined>(undefined)
  const infoTimerRef =
    useRef<
      ReturnType<typeof setTimeout> | undefined
    >(undefined)

  const preloadNext =
    config.common.filePreview.preloadNext

  const slides = useMemo(() => {
    const seen = new Set<string>()

    return files.filter((file) => {
      if (
        seen.has(file.id) ||
        filePreviewKind(
          file.mimeType,
          file.category,
        ) === "unsupported"
      ) {
        return false
      }

      seen.add(file.id)
      return true
    })
  }, [files])

  const currentIndex = slides.findIndex(
    (file) => file.id === currentFile.id,
  )
  const [selectedIndex, setSelectedIndex] =
    useState(Math.max(0, currentIndex))

  const preloadTargets = useMemo(
    () =>
      slides.slice(
        selectedIndex + 1,
        selectedIndex + 1 + preloadNext,
      ),
    [
      preloadNext,
      selectedIndex,
      slides,
    ],
  )

  const clearInfoTimer = useCallback(() => {
    if (!infoTimerRef.current) return

    clearTimeout(infoTimerRef.current)
    infoTimerRef.current = undefined
  }, [])

  const showInfo = useCallback(
    (autoHide = false) => {
      clearInfoTimer()
      setInfoVisible(true)

      if (autoHide) {
        infoTimerRef.current = setTimeout(
          () => {
            setInfoVisible(false)
            infoTimerRef.current = undefined
          },
          infoAutoHideMs,
        )
      }
    },
    [clearInfoTimer],
  )

  const hideInfo = useCallback(() => {
    clearInfoTimer()
    setInfoVisible(false)
  }, [clearInfoTimer])

  useEffect(() => {
    setPreviewPreloadWindow(
      preloadOwnerRef.current,
      preloadTargets,
      collectionId,
    )
  }, [collectionId, preloadTargets])

  useEffect(() => {
    const preloadOwner =
      preloadOwnerRef.current

    return () => {
      clearPreviewPreloadWindow(
        preloadOwner,
      )
      clearInfoTimer()
    }
  }, [clearInfoTimer])

  useEffect(() => {
    navigatingToRef.current = undefined
    showInfo(true)

    if (!api || currentIndex < 0) return

    setSelectedIndex(currentIndex)
    api.scrollTo(currentIndex, true)
  }, [
    api,
    currentFile.id,
    currentIndex,
    showInfo,
  ])

  useEffect(() => {
    if (!api) return

    const select = () => {
      const index =
        api.selectedScrollSnap()
      const selected = slides[index]

      setSelectedIndex(index)
      showInfo(true)

      if (
        !selected ||
        selected.id === currentFile.id
      ) {
        navigatingToRef.current = undefined
        return
      }

      if (
        navigatingToRef.current ===
        selected.id
      ) {
        return
      }

      navigatingToRef.current =
        selected.id

      router.replace(
        `${routeBase}/${encodeURIComponent(selected.id)}`,
        { scroll: false },
      )
    }

    api.on("select", select)

    return () => {
      api.off("select", select)
    }
  }, [
    api,
    currentFile.id,
    routeBase,
    router,
    showInfo,
    slides,
  ])

  if (
    currentIndex < 0 ||
    slides.length < 2
  ) {
    return (
      <FilePreview
        file={currentFile}
        collectionId={collectionId}
        preloadNext={preloadNext}
      />
    )
  }

  const selected = slides[selectedIndex]

  return (
    <Carousel
      setApi={setApi}
      opts={{
        startIndex: currentIndex,
        align: "start",
        loop: false,
      }}
      tabIndex={0}
      aria-label="File preview"
      className="min-w-0"
      onMouseEnter={() => showInfo()}
      onMouseMove={() => {
        if (!infoVisible) showInfo()
      }}
      onMouseLeave={hideInfo}
      onFocusCapture={() => showInfo()}
    >
      <CarouselContent className="ml-0">
        {slides.map((file, index) => (
          <CarouselItem
            key={file.id}
            className="pl-0"
          >
            {file.id === currentFile.id ? (
              <FilePreview
                file={currentFile}
                collectionId={collectionId}
                preloadNext={preloadNext}
              />
            ) : (
              <PendingPreview
                file={file}
                active={
                  index === selectedIndex
                }
              />
            )}
          </CarouselItem>
        ))}
      </CarouselContent>

      <CarouselPrevious
        variant="secondary"
        className="left-3 z-20 bg-background/85 shadow-md backdrop-blur-md"
      />

      <CarouselNext
        variant="secondary"
        className="right-3 z-20 bg-background/85 shadow-md backdrop-blur-md"
      />

      {selected && (
        <>
          <p
            className="sr-only"
            role="status"
            aria-live="polite"
          >
            {selected.name},{" "}
            {selectedIndex + 1} of{" "}
            {slides.length}
          </p>

          <div
            aria-hidden
            className={cn(
              "pointer-events-none absolute bottom-3 left-1/2 z-20 max-w-[70%] -translate-x-1/2 rounded-full border bg-background/85 px-3 py-1.5 text-center text-xs shadow-sm backdrop-blur-md transition-[opacity,transform] duration-200",
              infoVisible
                ? "-translate-y-0 opacity-100"
                : "translate-y-2 opacity-0",
            )}
          >
            <span className="block truncate">
              {selected.name}
            </span>
            <span className="text-muted-foreground">
              {selectedIndex + 1} /{" "}
              {slides.length}
            </span>
          </div>
        </>
      )}
    </Carousel>
  )
}

function PendingPreview({
  file,
  active,
}: {
  file: PreviewCarouselFile
  active: boolean
}) {
  return (
    <div className="grid min-h-80 place-items-center overflow-hidden rounded-xl border bg-muted/20 sm:h-[70vh]">
      <div className="flex max-w-sm flex-col items-center gap-3 px-6 text-center">
        {active ? (
          <Spinner className="size-6" />
        ) : (
          <FileIcon className="size-8 text-muted-foreground" />
        )}

        <div className="min-w-0">
          <p className="truncate text-sm font-medium">
            {file.name}
          </p>

          {active && (
            <p className="mt-1 text-xs text-muted-foreground">
              Opening preview…
            </p>
          )}
        </div>
      </div>
    </div>
  )
}