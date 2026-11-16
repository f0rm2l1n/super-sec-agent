"""Failure-mode tests for the Compose operator entrypoint (no daemon required)."""
import argparse
import json
from pathlib import Path
import runpy
import subprocess
import tempfile
import unittest
from unittest.mock import Mock, call, patch

module = runpy.run_path(str(Path(__file__).resolve().parents[1] / 'scripts/deploy'))
Deployment = module['Deployment']


class DeploymentTest(unittest.TestCase):
    def test_start_waits_up_to_fifteen_minutes_for_slow_startup(self):
        deploy = Deployment.__new__(Deployment)
        deploy.compose = Mock()
        deploy.start()
        deploy.compose.assert_called_once_with('up', '-d', '--wait', '--wait-timeout', '900', 'superagent-sec')

    def deployment(self, root):
        env = root / 'operator.env'
        env.write_text('SUPERAGENT_PROJECT_ID=wrong\nDONT_EXECUTE=$(touch should-not-exist)\n')
        config = {'services': {'superagent-sec': {
            'image': 'app:test', 'environment': {'SUPERAGENT_PROJECT_ID': 'test', 'SUPERAGENT_WORKSPACE': '/var/lib/superagent/projects/test/workspace'},
            'volumes': [{'type': 'bind', 'source': str(root / 'resolved-projects'), 'target': '/var/lib/superagent/projects'}],
        }}}
        with patch.object(Deployment, 'compose', return_value=subprocess.CompletedProcess([], 0, json.dumps(config), '')), patch.object(Deployment, 'adopt_existing'):
            return Deployment(env)

    def test_uses_compose_resolved_paths_without_sourcing_shell(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            deploy = self.deployment(root)
            self.assertEqual(deploy.project_id, 'test')
            self.assertEqual(deploy.host_workspace, root / 'resolved-projects/test/workspace')
            self.assertFalse((root / 'should-not-exist').exists())

    def test_existing_baseline_is_never_recopied_or_relocked(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            deploy = self.deployment(root)
            deploy.host_workspace.mkdir(parents=True)
            (deploy.host_workspace / 'sources.lock.json').write_text('reviewed baseline')
            source = root / 'source'
            source.mkdir()
            deploy.build = Mock()
            args = argparse.Namespace(project_id='test', source_dir=str(source), source_id='main')
            with self.assertRaisesRegex(RuntimeError, 'reviewed baseline'):
                deploy.prepare(args)
            deploy.build.assert_not_called()
            self.assertEqual((deploy.host_workspace / 'sources.lock.json').read_text(), 'reviewed baseline')

    def test_project_mismatch_fails_before_copy_or_build(self):
        with tempfile.TemporaryDirectory() as directory:
            deploy = self.deployment(Path(directory))
            with self.assertRaisesRegex(RuntimeError, 'not other'):
                deploy.prepare(argparse.Namespace(project_id='other'))

    def test_adopts_the_legacy_compose_project_name_from_existing_mounts(self):
        with tempfile.TemporaryDirectory() as directory:
            deploy = self.deployment(Path(directory))
            deploy.mounts['/var/lib/superagent/state'] = Path(directory) / 'state'
            container = {'Config': {'Labels': {'com.docker.compose.project': 'deploy'}}, 'Mounts': [
                {'Destination': target, 'Source': str(source)} for target, source in deploy.mounts.items()]}
            responses = [subprocess.CompletedProcess([], 0, 'legacy-id', ''),
                         subprocess.CompletedProcess([], 0, json.dumps([container]), '')]
            with patch.dict(Deployment.adopt_existing.__globals__, run=Mock(side_effect=responses)):
                deploy.adopt_existing()
            self.assertEqual(deploy.command[-2:], ['-p', 'deploy'])

    def test_update_never_pauses_a_service_when_build_fails(self):
        deploy = Deployment.__new__(Deployment)
        deploy.compose = Mock(return_value=subprocess.CompletedProcess([], 0, '', ''))
        deploy.build = Mock(side_effect=RuntimeError('build failed'))
        deploy.api = Mock()
        with self.assertRaisesRegex(RuntimeError, 'build failed'):
            deploy.update()
        deploy.api.assert_not_called()

    def test_update_can_start_a_stopped_installation(self):
        deploy = Deployment.__new__(Deployment)
        deploy.compose = Mock(return_value=subprocess.CompletedProcess([], 0, '', ''))
        deploy.build = Mock()
        deploy.start = Mock()
        deploy.url = Mock()
        deploy.api = Mock()
        deploy.update()
        deploy.start.assert_called_once()
        deploy.url.assert_called_once()
        deploy.api.assert_not_called()

    def test_network_recreation_waits_for_idle_research_and_preserves_data(self):
        deploy = Deployment.__new__(Deployment)
        deploy.service = {'image': 'app:test'}
        deploy.compose = Mock(return_value=subprocess.CompletedProcess([], 0, 'container-id', ''))
        deploy.build = Mock()
        state = {'continuous': {'enabled': True, 'activeRounds': []}}
        deploy.api = Mock(return_value=state)
        deploy.start = Mock()
        deploy.url = Mock()
        order = Mock()
        for name in ('build', 'api', 'compose', 'start'):
            order.attach_mock(getattr(deploy, name), name)
        with patch.dict(Deployment.update.__globals__, run=Mock(return_value=subprocess.CompletedProcess([], 0, 'previous-image-id', ''))):
            deploy.update(recreate_network=True)
        calls = order.mock_calls
        down = calls.index(call.compose('down'))
        self.assertLess(calls.index(call.api('research/continuous', {'enabled': False})), down)
        research_checks = [i for i, recorded in enumerate(calls) if recorded == call.api('research')]
        self.assertEqual(len(research_checks), 2)
        self.assertLess(research_checks[-1], down)
        self.assertLess(down, calls.index(call.start()))
        deploy.compose.assert_any_call('down')
        self.assertFalse(any('-v' in call.args for call in deploy.compose.call_args_list))
        deploy.api.assert_any_call('research/continuous', {'enabled': True, 'preserveBlockers': True})

    def test_network_recreation_does_not_stop_active_research(self):
        deploy = Deployment.__new__(Deployment)
        deploy.compose = Mock(return_value=subprocess.CompletedProcess([], 0, 'container-id', ''))
        deploy.build = Mock()
        deploy.api = Mock(return_value={'continuous': {'enabled': False, 'activeRounds': ['round']}})
        deploy.start = Mock()
        with patch.dict(Deployment.update.__globals__,
                        run=Mock(return_value=subprocess.CompletedProcess([], 0, 'previous-image-id', '')),
                        time=Mock(monotonic=Mock(side_effect=[0, 61]))):
            with self.assertRaisesRegex(RuntimeError, 'still finishing'):
                deploy.update(recreate_network=True)
        deploy.start.assert_not_called()
        self.assertNotIn(call('down'), deploy.compose.call_args_list)

    def test_failed_restart_rolls_back_and_restores_the_prior_research_setting(self):
        deploy = Deployment.__new__(Deployment)
        deploy.service = {'image': 'app:test'}
        deploy.compose = Mock(return_value=subprocess.CompletedProcess([], 0, 'container-id', ''))
        deploy.build = Mock()
        deploy.api = Mock(return_value={'continuous': {'enabled': True, 'activeRounds': []}})
        deploy.start = Mock(side_effect=[subprocess.CalledProcessError(1, 'up'), None])
        with patch.dict(Deployment.update.__globals__, run=Mock(return_value=subprocess.CompletedProcess([], 0, 'previous-image-id', ''))) as _:
            with self.assertRaises(subprocess.CalledProcessError):
                deploy.update()
            calls = Deployment.update.__globals__['run'].call_args_list
            self.assertEqual(calls[-1].args[0], ['docker', 'tag', 'previous-image-id', 'app:test'])
        deploy.api.assert_any_call('research/continuous', {'enabled': False})
        deploy.api.assert_any_call('research/continuous', {'enabled': True, 'preserveBlockers': True})
        self.assertEqual(deploy.start.call_count, 2)

    def test_failed_restore_does_not_mask_the_original_upgrade_error(self):
        deploy = Deployment.__new__(Deployment)
        deploy.service = {'image': 'app:test'}
        deploy.compose = Mock(return_value=subprocess.CompletedProcess([], 0, 'container-id', ''))
        deploy.build = Mock()
        state = {'continuous': {'enabled': True, 'activeRounds': []}}
        deploy.api = Mock(side_effect=[state, None, state, RuntimeError('old API')])
        original = subprocess.CalledProcessError(1, 'upgrade')
        deploy.start = Mock(side_effect=[original, None])
        with patch.dict(Deployment.update.__globals__, run=Mock(return_value=subprocess.CompletedProcess([], 0, 'previous-image-id', ''))):
            with self.assertRaises(subprocess.CalledProcessError) as error:
                deploy.update()
        self.assertIs(error.exception, original)
        self.assertEqual(deploy.api.call_count, 4)


if __name__ == '__main__':
    unittest.main()
