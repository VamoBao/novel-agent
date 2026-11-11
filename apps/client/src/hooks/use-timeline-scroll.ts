import { useEffect, useRef, useState } from "react";
import type { TimelineEntry } from "./session-timeline";

/** 只在用户靠近底部时跟随新事件；查看历史和定位导航不抢滚动或输入焦点。 */
export function useTimelineScroll(timeline: TimelineEntry[]) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const streamRef = useRef<HTMLElement>(null);
  const followingRef = useRef(true);
  const [unread, setUnread] = useState(false);

  useEffect(() => {
    if (!timeline.length) { followingRef.current = true; setUnread(false); }
    if (followingRef.current) bottomRef.current?.scrollIntoView?.({ behavior: "instant", block: "end" });
    else setUnread(true);
  }, [timeline]);

  const onScroll = (): void => {
    const node = streamRef.current;
    if (!node) return;
    followingRef.current = node.scrollHeight - node.scrollTop - node.clientHeight < 96;
    if (followingRef.current) setUnread(false);
  };
  const scrollTo = (node: Element | null | undefined): void => {
    if (!node) return;
    followingRef.current = false;
    node.scrollIntoView?.({ behavior: "smooth", block: "start" });
  };
  const latest = (): void => {
    followingRef.current = true; setUnread(false);
    bottomRef.current?.scrollIntoView?.({ behavior: "smooth", block: "end" });
  };
  return { bottomRef, streamRef, followingRef, unread, onScroll, scrollTo, latest };
}
