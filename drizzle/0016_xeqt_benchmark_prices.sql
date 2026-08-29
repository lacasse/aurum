-- The benchmark series, as data rather than as a fetch.
--
-- XEQT's month-end price from February 2020 to July 2026, 78 months, in CAD.
-- Unlike everything else imported in this range of migrations, this is not one
-- user's private history: it is a published closing price, the same for
-- everybody, so it belongs in the repository where every deployment gets it.
--
-- It replaces a live fetch that never worked. The benchmark was read from
-- Yahoo's chart endpoint, which answers a burst from one address with 429s
-- lasting many minutes and refused every request across an entire day of
-- attempts. The route fell back to a deterministic simulation when that
-- happened, so the "XEQT" line on the chart was a random walk — plausible
-- looking, labelled in a badge most people would not read, and wrong. A number
-- that is quietly invented is worse than one that is missing, and a benchmark
-- that only moves when a third party feels like answering is not a dependency
-- worth having for data that never changes.
--
-- Stored in price_history under source 'benchmark' to distinguish it from a
-- user's own 'snapshot' figures and from anything a provider supplied.
-- Re-running updates the price in place, so a corrected close can be shipped
-- by editing this file.

INSERT INTO "price_history" ("ticker", "month", "close", "currency", "source")
VALUES
	('XEQT.TO', '2020-02', 20.83, 'CAD', 'benchmark'),
	('XEQT.TO', '2020-03', 17.44, 'CAD', 'benchmark'),
	('XEQT.TO', '2020-04', 19.17, 'CAD', 'benchmark'),
	('XEQT.TO', '2020-05', 20.3, 'CAD', 'benchmark'),
	('XEQT.TO', '2020-06', 20.47, 'CAD', 'benchmark'),
	('XEQT.TO', '2020-07', 21.21, 'CAD', 'benchmark'),
	('XEQT.TO', '2020-08', 21.9, 'CAD', 'benchmark'),
	('XEQT.TO', '2020-09', 21.55, 'CAD', 'benchmark'),
	('XEQT.TO', '2020-10', 20.93, 'CAD', 'benchmark'),
	('XEQT.TO', '2020-11', 23.12, 'CAD', 'benchmark'),
	('XEQT.TO', '2020-12', 23.53, 'CAD', 'benchmark'),
	('XEQT.TO', '2021-01', 23.54, 'CAD', 'benchmark'),
	('XEQT.TO', '2021-02', 24.42, 'CAD', 'benchmark'),
	('XEQT.TO', '2021-03', 24.63, 'CAD', 'benchmark'),
	('XEQT.TO', '2021-04', 25.15, 'CAD', 'benchmark'),
	('XEQT.TO', '2021-05', 25.3, 'CAD', 'benchmark'),
	('XEQT.TO', '2021-06', 26.03, 'CAD', 'benchmark'),
	('XEQT.TO', '2021-07', 26.37, 'CAD', 'benchmark'),
	('XEQT.TO', '2021-08', 27.22, 'CAD', 'benchmark'),
	('XEQT.TO', '2021-09', 26.18, 'CAD', 'benchmark'),
	('XEQT.TO', '2021-10', 27.09, 'CAD', 'benchmark'),
	('XEQT.TO', '2021-11', 27.09, 'CAD', 'benchmark'),
	('XEQT.TO', '2021-12', 27.65, 'CAD', 'benchmark'),
	('XEQT.TO', '2022-01', 26.65, 'CAD', 'benchmark'),
	('XEQT.TO', '2022-02', 26.09, 'CAD', 'benchmark'),
	('XEQT.TO', '2022-03', 26.35, 'CAD', 'benchmark'),
	('XEQT.TO', '2022-04', 24.89, 'CAD', 'benchmark'),
	('XEQT.TO', '2022-05', 24.71, 'CAD', 'benchmark'),
	('XEQT.TO', '2022-06', 22.77, 'CAD', 'benchmark'),
	('XEQT.TO', '2022-07', 24.14, 'CAD', 'benchmark'),
	('XEQT.TO', '2022-08', 23.7, 'CAD', 'benchmark'),
	('XEQT.TO', '2022-09', 22.54, 'CAD', 'benchmark'),
	('XEQT.TO', '2022-10', 23.72, 'CAD', 'benchmark'),
	('XEQT.TO', '2022-11', 25.21, 'CAD', 'benchmark'),
	('XEQT.TO', '2022-12', 24.12, 'CAD', 'benchmark'),
	('XEQT.TO', '2023-01', 25.56, 'CAD', 'benchmark'),
	('XEQT.TO', '2023-02', 25.37, 'CAD', 'benchmark'),
	('XEQT.TO', '2023-03', 25.57, 'CAD', 'benchmark'),
	('XEQT.TO', '2023-04', 26.09, 'CAD', 'benchmark'),
	('XEQT.TO', '2023-05', 25.59, 'CAD', 'benchmark'),
	('XEQT.TO', '2023-06', 26.18, 'CAD', 'benchmark'),
	('XEQT.TO', '2023-07', 26.96, 'CAD', 'benchmark'),
	('XEQT.TO', '2023-08', 26.81, 'CAD', 'benchmark'),
	('XEQT.TO', '2023-09', 25.68, 'CAD', 'benchmark'),
	('XEQT.TO', '2023-10', 25.33, 'CAD', 'benchmark'),
	('XEQT.TO', '2023-11', 27.03, 'CAD', 'benchmark'),
	('XEQT.TO', '2023-12', 27.66, 'CAD', 'benchmark'),
	('XEQT.TO', '2024-01', 28.06, 'CAD', 'benchmark'),
	('XEQT.TO', '2024-02', 29.34, 'CAD', 'benchmark'),
	('XEQT.TO', '2024-03', 30.19, 'CAD', 'benchmark'),
	('XEQT.TO', '2024-04', 29.59, 'CAD', 'benchmark'),
	('XEQT.TO', '2024-05', 30.57, 'CAD', 'benchmark'),
	('XEQT.TO', '2024-06', 30.62, 'CAD', 'benchmark'),
	('XEQT.TO', '2024-07', 31.76, 'CAD', 'benchmark'),
	('XEQT.TO', '2024-08', 31.81, 'CAD', 'benchmark'),
	('XEQT.TO', '2024-09', 32.26, 'CAD', 'benchmark'),
	('XEQT.TO', '2024-10', 32.79, 'CAD', 'benchmark'),
	('XEQT.TO', '2024-11', 34.47, 'CAD', 'benchmark'),
	('XEQT.TO', '2024-12', 33.68, 'CAD', 'benchmark'),
	('XEQT.TO', '2025-01', 35.12, 'CAD', 'benchmark'),
	('XEQT.TO', '2025-02', 34.92, 'CAD', 'benchmark'),
	('XEQT.TO', '2025-03', 33.62, 'CAD', 'benchmark'),
	('XEQT.TO', '2025-04', 33.0, 'CAD', 'benchmark'),
	('XEQT.TO', '2025-05', 34.6, 'CAD', 'benchmark'),
	('XEQT.TO', '2025-06', 35.47, 'CAD', 'benchmark'),
	('XEQT.TO', '2025-07', 35.78, 'CAD', 'benchmark'),
	('XEQT.TO', '2025-08', 37.3, 'CAD', 'benchmark'),
	('XEQT.TO', '2025-09', 39.11, 'CAD', 'benchmark'),
	('XEQT.TO', '2025-10', 39.83, 'CAD', 'benchmark'),
	('XEQT.TO', '2025-11', 40.32, 'CAD', 'benchmark'),
	('XEQT.TO', '2025-12', 39.89, 'CAD', 'benchmark'),
	('XEQT.TO', '2026-01', 40.65, 'CAD', 'benchmark'),
	('XEQT.TO', '2026-02', 42.02, 'CAD', 'benchmark'),
	('XEQT.TO', '2026-03', 40.4, 'CAD', 'benchmark'),
	('XEQT.TO', '2026-04', 42.4, 'CAD', 'benchmark'),
	('XEQT.TO', '2026-05', 44.45, 'CAD', 'benchmark'),
	('XEQT.TO', '2026-06', 45.1, 'CAD', 'benchmark'),
	('XEQT.TO', '2026-07', 44.8, 'CAD', 'benchmark')
ON CONFLICT ("ticker", "month") DO UPDATE SET
	"close" = excluded."close",
	"currency" = excluded."currency",
	"source" = excluded."source";
