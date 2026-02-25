import unittest

from app.core.filtering import CensoredWordsFilter


class CensoredWordsFilterTests(unittest.TestCase):
    def test_replaces_banned_words_case_insensitive(self):
        text_filter = CensoredWordsFilter(("badword", "spam"))
        source = "BadWord should be hidden. spam is blocked. but spammer should stay."

        result = text_filter.apply(source)

        self.assertIn("*** should be hidden.", result)
        self.assertIn("*** is blocked.", result)
        self.assertIn("spammer should stay.", result)


if __name__ == "__main__":
    unittest.main()
