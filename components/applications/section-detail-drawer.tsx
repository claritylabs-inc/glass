"use client";

import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";
import { ReviewGroupPane } from "./review-group-pane";
import type { Id, Doc } from "@/convex/_generated/dataModel";

const EASE = [0.16, 1, 0.3, 1] as const;
const WIDTH = 560;

type Props = {
  open: boolean;
  onClose: () => void;
  applicationId: Id<"applications">;
  group: Doc<"applicationGroups"> | null;
  questions: Doc<"applicationQuestions">[];
  answers: Doc<"applicationAnswers">[];
  flags: Doc<"applicationQuestionFlags">[];
};

export function SectionDetailDrawer({
  open,
  onClose,
  applicationId,
  group,
  questions,
  answers,
  flags,
}: Props) {
  return (
    <AnimatePresence mode="popLayout">
      {open && group && (
        <motion.div
          layout
          initial={{ width: 0 }}
          animate={{ width: WIDTH }}
          exit={{ width: 0 }}
          transition={{ duration: 0.35, ease: EASE }}
          className="flex shrink-0 overflow-hidden h-full"
        >
          <motion.div
            initial={{ opacity: 0, x: 30 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 30 }}
            transition={{ duration: 0.3, ease: EASE, delay: 0.05 }}
            className="flex flex-col flex-1 min-h-0 border-l border-foreground/6 bg-background"
            style={{ width: WIDTH }}
          >
            <div className="h-12 flex items-center gap-3 px-4 border-b border-foreground/6 shrink-0">
              <span className="text-body-sm font-medium text-foreground truncate">
                {group.title}
              </span>
              <span className="shrink-0 rounded-full border border-foreground/10 bg-muted/30 px-2 py-0.5 text-[11px] capitalize text-muted-foreground">
                {group.status.replaceAll("_", " ")}
              </span>
              <div className="flex-1" />
              <button
                type="button"
                onClick={onClose}
                className="w-7 h-7 flex items-center justify-center rounded-md text-muted-foreground/40 hover:text-foreground hover:bg-foreground/[0.04] transition-colors cursor-pointer shrink-0"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-5">
              <ReviewGroupPane
                applicationId={applicationId}
                group={group}
                questions={questions}
                answers={answers}
                flags={flags}
                onClose={onClose}
              />
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
