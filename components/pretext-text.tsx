"use client";

import {
  layoutWithLines,
  prepareWithSegments,
  type PrepareOptions,
} from "@chenglou/pretext";
import {
  type CSSProperties,
  type ElementType,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { cn } from "@/lib/utils";

type PretextTextProps<T extends ElementType = "span"> = {
  as?: T;
  text: string;
  className?: string;
  style?: CSSProperties;
  title?: string;
  whiteSpace?: PrepareOptions["whiteSpace"];
  wordBreak?: PrepareOptions["wordBreak"];
  children?: never;
};

type TextMetrics = {
  font: string;
  letterSpacing: number;
  lineHeight: number;
};

function readMetrics(node: HTMLElement): TextMetrics {
  const styles = window.getComputedStyle(node);
  const font = styles.font;
  const fontSize = Number.parseFloat(styles.fontSize) || 13;
  const lineHeight =
    styles.lineHeight === "normal"
      ? fontSize * 1.5
      : Number.parseFloat(styles.lineHeight) || fontSize * 1.5;
  const letterSpacing =
    styles.letterSpacing === "normal"
      ? 0
      : Number.parseFloat(styles.letterSpacing) || 0;

  return { font, letterSpacing, lineHeight };
}

export function PretextText<T extends ElementType = "span">({
  as,
  text,
  className,
  style,
  title,
  whiteSpace = "normal",
  wordBreak = "normal",
}: PretextTextProps<T>) {
  const Tag = (as ?? "span") as ElementType;
  const ref = useRef<HTMLElement | null>(null);
  const [width, setWidth] = useState(0);
  const [metrics, setMetrics] = useState<TextMetrics | null>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    let cancelled = false;

    const update = () => {
      if (cancelled) return;
      setWidth(node.clientWidth);
      setMetrics(readMetrics(node));
    };
    update();

    const observer = new ResizeObserver(update);
    observer.observe(node);

    if (document.fonts) {
      document.fonts.ready.then(update).catch(() => {});
    }

    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, []);

  const lines = useMemo(() => {
    if (!metrics || width <= 0 || !text) return null;

    try {
      const prepared = prepareWithSegments(text, metrics.font, {
        whiteSpace,
        wordBreak,
        letterSpacing: metrics.letterSpacing,
      });
      return layoutWithLines(prepared, width, metrics.lineHeight).lines;
    } catch {
      return null;
    }
  }, [metrics, text, whiteSpace, width, wordBreak]);

  let rendered: ReactNode = text;
  if (lines && lines.length > 0) {
    rendered = lines.map((line, index) => (
      <span key={`${index}-${line.start.segmentIndex}-${line.start.graphemeIndex}`}>
        {line.text}
        {index < lines.length - 1 ? <br /> : null}
      </span>
    ));
  }

  return (
    <Tag
      ref={ref}
      className={cn("pretext-text", className)}
      style={style}
      title={title}
      data-pretext=""
      data-pretext-white-space={whiteSpace}
    >
      {rendered}
    </Tag>
  );
}

export function getPlainTextChildren(children: ReactNode): string | null {
  if (children === null || children === undefined || typeof children === "boolean") {
    return "";
  }
  if (typeof children === "string" || typeof children === "number") {
    return String(children);
  }
  if (Array.isArray(children)) {
    let result = "";
    for (const child of children) {
      const text = getPlainTextChildren(child);
      if (text === null) return null;
      result += text;
    }
    return result;
  }
  return null;
}
