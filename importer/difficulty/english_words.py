"""Writes js/english-words.js: the 25,000 most common English words (3+ letters, a-z only),
most common first, from wordfreq (pip install wordfreq). Used by js/difficulty.js."""
import pathlib
import wordfreq

words = [w for w in wordfreq.top_n_list('en', 60000) if w.isalpha() and w.isascii() and len(w) >= 3][:25000]
out = pathlib.Path(__file__).resolve().parents[2] / 'js' / 'english-words.js'
out.write_text(
    "// The 25,000 most common English words of 3+ letters, most common first (from the wordfreq\n"
    "// project's English list). js/difficulty.js uses a word's place here to tell everyday words\n"
    "// from technical ones. Regenerate with importer/difficulty/english_words.py.\n"
    "export default '" + ' '.join(words) + "';\n")
