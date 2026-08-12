export type PreparedPdfSource<TPrepared, TConverted> =
  | { parser: "liteparse"; prepared: TPrepared; converted: TConverted }
  | { parser: "pdfjs"; prepared: TPrepared };

/**
 * Fall back only when LiteParse conversion itself fails. Work performed after
 * a successful conversion (supplementation, model extraction, validation)
 * stays outside this error boundary and must fail the job truthfully.
 */
export async function preparePdfSourceWithLiteParseFallback<TConverted, TPrepared>(
  options: {
    convertWithLiteParse: () => Promise<TConverted>;
    prepareLiteParseSource: (converted: TConverted) => Promise<TPrepared>;
    preparePdfJsSource: (conversionError: unknown) => Promise<TPrepared>;
    onLiteParseFailure?: (conversionError: unknown) => void | Promise<void>;
  },
): Promise<PreparedPdfSource<TPrepared, TConverted>> {
  let converted: TConverted;
  try {
    converted = await options.convertWithLiteParse();
  } catch (error) {
    await options.onLiteParseFailure?.(error);
    return {
      parser: "pdfjs",
      prepared: await options.preparePdfJsSource(error),
    };
  }

  return {
    parser: "liteparse",
    prepared: await options.prepareLiteParseSource(converted),
    converted,
  };
}
