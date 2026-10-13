import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from urllib.error import URLError
import pda

FIXTURES = Path(__file__).parent / 'fixtures'
TEST_CONFIG = {'postcode': 'EXAMPLE', 'origin': (0.0, 0.0), 'radius': 40, 'max_drive': 60}

class FinderTests(unittest.TestCase):
    def test_live_fixtures_and_deduplication(self):
        gov, more = pda.parse_gov((FIXTURES / 'gov.html').read_text())
        higher, _ = pda.parse_higherin((FIXTURES / 'higherin.html').read_text())
        self.assertFalse(more)
        local = [j for j in higher if pda.nearby(j['location'])]
        jobs = pda.deduplicate(gov + local)
        self.assertEqual(len(jobs), 1)
        self.assertEqual(len(jobs[0]['also_listed_on']), 1)
        self.assertEqual(jobs[0]['salary'], '£24,000 a year')
        self.assertEqual(pda.parse_ngtu((FIXTURES / 'ngtu.json').read_text())[0], [])

    def test_strict_levels(self):
        self.assertTrue(pda.software_match('Software Engineering Apprentice', 'level 6'))
        for title, level in [('Software Engineering', 'level 7'), ('Software Development', 'level 4'), ('Technology degree apprentice', 'degree'), ('Cyber Security', 'level 6')]:
            self.assertFalse(pda.software_match(title, level))

    def test_dates(self):
        self.assertEqual(pda.closing_timestamp('Closes on Wednesday 17 February 2027'), pda.closing_timestamp('17th February 2027'))
        self.assertIsNone(pda.closing_timestamp('Ongoing'))

    def test_failed_fetch_preserves_successful_cache(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as tmp:
            with patch.object(pda, 'STATE', Path(tmp)):
                original = {'jobs': [{'id': 'kept'}], 'checked_at': 1, 'error': None}
                pda.write_json(Path(tmp) / 'gov.json', original)
                with patch.object(pda, 'request', side_effect=URLError('offline')):
                    result = pda.fetch_source('gov', refresh=True, config=TEST_CONFIG)
                self.assertEqual(result['jobs'], original['jobs'])
                self.assertTrue(result['error'])
                self.assertEqual(pda.read_json(Path(tmp) / 'gov.json', {}), original)

    def test_pagination_and_partial_limit(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as tmp:
            with patch.object(pda, 'STATE', Path(tmp)), patch.object(pda, 'request', return_value='page') as req:
                with patch.dict(pda.PARSERS, {'gov': lambda _: ([], True)}):
                    result = pda.fetch_source('gov', True, 2, TEST_CONFIG)
                self.assertEqual(req.call_count, 2)
                self.assertTrue(result['incomplete'])

    def test_changed_html_is_an_error(self):
        for fn in (pda.parse_gov, pda.parse_higherin):
            with self.assertRaises(ValueError):
                fn('<html>blocked</html>')

if __name__ == '__main__':
    unittest.main()
