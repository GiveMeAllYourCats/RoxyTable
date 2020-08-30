var ioSettings = {
	reconnection: true, // whether to reconnect automatically
	reconnectionAttempts: Infinity, // number of reconnection attempts before giving up
	reconnectionDelay: 1000, // how long to initially wait before attempting a new reconnection
	reconnectionDelayMax: 5000, // maximum amount of time to wait between reconnection attempts. Each attempt increases the reconnection delay by 2x along with a randomization factor
	randomizationFactor: 0.5
}

function listenSockets() {
	socket.on('connect', () => {
		toastr.success('Connected to the socket server')
	})

	socket.on('disconnect', () => {
		toastr.error('Disconnected from the socket server')
	})

	socket.on('reconnecting', () => {
		toastr.warning('Trying to reconnect to the socket server..')
	})

	socket.on('reconnect', () => {
		InstantClick.go('/')
		setTimeout(function () {
			toastr.success('Reconnected to the socket server')
		}, 500)
	})
}

function listPage() {
	if (!window.socket) {
		window.socket = io(ioSettings)
		listenSockets()
	}

	socket.emit('requestTable')
	$.blockUI({
		message: ''
	})
	socket.on('table', function (tables) {
		console.log({ tables })

		for (var index in tables) {
			var stateValue = tables[index]
			var selector = $('input[data-table="' + index + '"]')
			selector.prop('checked', false)
			selector.eq(stateValue).prop('checked', true)
		}
		$.unblockUI()
	})

	socket.on('infomessage', function (msg) {
		toastr.info(msg)
	})

	$('input[type="checkbox"]')
		.unbind('click')
		.unbind('touchstart')
		.on('click touchstart', function (e) {
			e.preventDefault()
			var updatePayload = {}
			updatePayload.value = $(this).data('value')
			updatePayload.table = $(this).data('table')

			// Local update
			// $('input[data-table="' + updatePayload.table + '"]').prop('checked', false)
			// $(this).prop('checked', true)

			socket.emit('tableUpdate', updatePayload)
		})
}

$(function () {
	if (window.location.pathname === '/') {
		listPage()
	}

	if (errormessage) {
		console.log({ errormessage })
		toastr.error(errormessage)
	}
	if (successmessage) {
		console.log({ successmessage })
		toastr.success(successmessage)
	}
	if ($('form').length) {
		$('form').ajaxForm(function () {
			listPage()
			InstantClick.go('/')
		})
	}
})

InstantClick.go = function (url) {
	var link = document.createElement('a')
	link.href = url
	document.body.appendChild(link)
	link.click()
}
