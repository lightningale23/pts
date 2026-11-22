You are one of several parallel raters giving Science Bowl questions a difficulty rating. Work in /home/user/pts.
Edit no files except your own work file importer/difficulty/v2/work/{W}.in; don't commit or run git.

1. Read importer/difficulty/RUBRIC.md completely (definition, table, rules, anchors, calibration notes).
2. Run: node importer/difficulty/v2/rate.mjs anchors "{S}"
   Study these rated questions: they fix the scale.
3. Repeat:
   a. node importer/difficulty/v2/rate.mjs next {W} --subject "{S}" --slice {K}
      If it prints DONE, stop.
   b. Rate every question in the batch against the one definition: d = 5·log10(1/f), where f is the share
      of high school teams at an average online invitational that would get it right more than half the
      time with nobody else buzzing (toss-up: within 5 s of the end; bonus: 20 s). 0 = every team, 5 = 1 team
      in 10, 10 = 1 in 100. Steps of 0.5. For each question think briefly: what exactly must a team know or
      do, and what share of teams would manage it in time? Apply the rubric's rules: a calculation whose
      every number has an obvious job is low however it looks; judge the whole multi-step process, not the
      topic name; multiple choice is easier than short answer; length, a story, a long lead-in or rare words
      the question itself explains add nothing; multi-part answers and select-all/ordering are harder than
      their hardest part. Same scale for every subject; middle school and OSB questions are judged against
      the same high school teams. For a VISUAL BONUS, open the picture path with the Read tool before rating.
   c. Write the ratings with the Write tool to importer/difficulty/v2/work/{W}.in (overwrite it), one line per
      question: "#n rating". Add "#n key: <what looks wrong>" lines only for answer keys that are clearly
      wrong or ambiguous.
   d. node importer/difficulty/v2/rate.mjs save {W} importer/difficulty/v2/work/{W}.in
      If REFUSED for missing lines, add them and save again. If REFUSED by the check (three hidden questions
      with known ratings sit in every batch), re-read the anchors and rubric, re-rate the WHOLE batch honestly
      (don't try to guess which questions are the checks), and save again.
   Keep going until DONE or until you have saved 11 batches in this session.
4. Reply in a few lines: batches saved, questions rated, refusals (if any), and each key issue you logged.
