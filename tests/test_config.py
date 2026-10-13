from pathlib import Path
import tempfile
import unittest
from local_config import load_config, parse_env

class ConfigTests(unittest.TestCase):
    def test_quotes_comments_and_no_evaluation(self):
        self.assertEqual(parse_env('ORIGIN_POSTCODE="EXAMPLE LOCATION"\nVALUE=literal$(not-a-command)\nSEARCH_RADIUS_MILES=40 # comment'), {'ORIGIN_POSTCODE': 'EXAMPLE LOCATION', 'VALUE': 'literal$(not-a-command)', 'SEARCH_RADIUS_MILES': '40'})

    def test_local_file_and_environment_override(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as directory:
            path = Path(directory) / '.env.local'
            path.write_text('ORIGIN_POSTCODE=EXAMPLE\nORIGIN_LATITUDE=51\nORIGIN_LONGITUDE=0\n')
            settings = load_config(path, {'SEARCH_RADIUS_MILES': '25'})
            self.assertEqual(settings['postcode'], 'EXAMPLE')
            self.assertEqual(settings['origin'], (0.0, 51.0))
            self.assertEqual(settings['radius'], 25)

    def test_missing_postcode_is_an_explicit_error(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as directory:
            with self.assertRaisesRegex(ValueError, 'Set ORIGIN_POSTCODE'):
                load_config(Path(directory) / 'missing.env', {})

    def test_coordinates_can_be_resolved_later(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as directory:
            path = Path(directory) / '.env.local'; path.write_text('ORIGIN_POSTCODE=EXAMPLE\n')
            self.assertIsNone(load_config(path, {})['origin'])
