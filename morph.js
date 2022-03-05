window.onload = function () {
	document.addEventListener('keydown', key_check)
	var w = document.getElementById('wrapper')
	//Anzahl Tracks als Attribut des html-elements Wrapper merken
	w.dataset.tracknumber=1
	grid_number_changed('beat_number')
	//provisorisch: Beispiel laden
	//test_url(0)
	//canvas = document.getElementById('canv')
	//context = canvas.getContext('2d')
	
	//resizeContent()
	//grid_number_changed('beat_number')
}

var audioBuffers = {}

var schedInterval
var updateCycle = 20 // miliseconds
var schedCycle = 10 // miliseconds
var schedOverlap = (0.2 * schedCycle) / 1000 // seconds
var positionPointer = 0
var cycleTime = 1
var nextNote = {time: 0, sounds: [], position: 0}
var isPlaying = false
var swing_percentage = 1
var last_played_position = 0.9
var col_row = []
var canvas
var context
var audioContext

function test_url(n){
	const url_test = [
	'http://localhost:8000/engine.html?b=4&sd=4&ss=2122&sp=50&bpm=100&p=highhat-1111111111111111-snare-0000100100001001-kick-1100000001110000',
	'http://localhost:8000/engine.html?b=3&sd=3&ss=212&sp=60&bpm=70&p=highhat-110110110-snare-011011001-kick-100100100'
]
	const url_parameters = ['b','sd','ss','sp','bpm','p']
	var param = get_url_parameters(url_test[n], url_parameters)
	apply_url_param(param)
}

function get_url_parameters(url_string, parameters){
	const url=new URL(url_string)
	result = {}
	parameters.forEach(param => {
		result[param]=url.searchParams.get(param)
	})
	return result
}


function apply_url_param(param){
	if (param.b) set_control_value('beat_number', param.b) 
	if (param.sd) set_control_value('subdivision_number', param.sd) 
	if (param.sd) set_control_value('swing_style', param.ss)
	if (param.sp) set_control_value('swing_percentage', param.sp / 100)
	if (param.bpm) set_control_value('bpm', param.bpm)
	if (param.p) { //sounds müssen dann noch korrekt gesetzt werden
		var pat = parse_url_pattern(param.p)
		col_row = []
		var n = get_grid_dimensions()
		for (var i=0; i<n.columns; i++) col_row[i] = [] 
		var sounds = Object.keys(pat)
		var rows = sounds.length
		sounds.forEach((sound,row_number) => {
			var row_array = pat[sound].split('')
			row_array.forEach((item, col_number) => {
				item==='1' ? col_row[col_number][row_number] = true : col_row[col_number][row_number] = false
			})	
		})
		fill_in_divs(n.columns,rows,'wrapper')
		redraw_beat_patterns()
	}		
}

function parse_url_pattern(pat){
	var values = pat.split('-')
	var result = {}
	for (var i =0; i< values.length; i+=2){
		result[values[i]]=values[i+1]
	}
	return result
}


//beat / subdiv zahl ändern --> css grid unerwartetes verhalten
function grid_number_changed(control_name) {
	var v=get_control_values(['beat_number', 'subdivision_number','swing_style', 'swing_percentage'])
	
	if (control_name==='subdivision_number') {
		var s = document.getElementById("swing_style")
		var morph_patterns = get_morph_patterns(v['subdivision_number'])
		var s_length = s.options.length
		for (i = s_length-1; i >= 0; i--) s.options[i] = null //dropdown lehren
	
		morph_patterns.forEach(pat => {
			var element = document.createElement("option")
			element.innerText=pat
			s.append(element)
		})	
	}
	
	v=get_control_values(['beat_number', 'subdivision_number','swing_style', 'swing_percentage'])
	
	var full_swing_pattern=step_to_pattern(v['swing_style'].repeat(v['beat_number']))
	var total_tick_number = v['beat_number']*v['subdivision_number']
		
	var morphed_pattern = apply_swing_to_pattern(full_swing_pattern, v['swing_percentage'])
	
	if (control_name==='swing_percentage') {
		document.getElementById("swing_percentage_text").innerText=Math.round(100*v['swing_percentage']) + '%'
	}
	
	var fr_string = get_css_grid_fr_string(morphed_pattern)
	
	if (control_name==='beat_number' || control_name==='subdivision_number'){
		var n = get_grid_dimensions()
		col_row = []
		for (var i=0; i<total_tick_number; i++) col_row[i] = [] 
		fill_in_divs(morphed_pattern.length,n.rows,'wrapper')
		if (control_name==='beat_number'){
			cycleTime = bpm_to_cycletime(get_control_value('bpm'), get_control_value('beat_number'))	
		}
	}
	apply_grid_template_columns(fr_string, 'wrapper')	
}

function bpm_changed(event) {
	//var new_bpm = event.target.value funktioniert nicht bei manuellem event triggern
	var new_bpm = document.getElementById('bpm').value
	cycleTime = bpm_to_cycletime(new_bpm, get_control_value('beat_number'))
	document.getElementById('bpm_text').innerHTML = new_bpm
}

function start () {
	if (!audioContext){
		audioContext = new AudioContext()
		loadSounds()
	}
	isPlaying = !isPlaying
	if (isPlaying) {
	  // updatePosition();
	  nextNote.time = audioContext.currentTime
	  nextNote.sounds = []
	  last_played_position = 0.9
	  positionPointer = 0
	  schedInterval = setInterval(schedule, schedCycle)
	  
    // posInterval = setInterval(updatePosition, updateCycle);
    // animate();
  } else {
    clearInterval(schedInterval);
    // clearInterval(posInterval);
    // setTimeout(drawPattern, 50);
  }
}

//muss abgeändert werden, damit für variable pattern funktionierend.. 
//was geschieht mit current und next; was geschieht, wenn beat leer ist.
//last played position einführen. 
//evt alle subdivs in beat und mit mute arbeiten

/*
	Über den Zweck von getNextNote
	der Audiocontext erlaubt es mir, einen sound zu einer gewünschten Zeit abzuspielen. Die Zeit ist 
	relativ zur initialisierung des audiocontexts (in audiocontext.currentTime gespeichert). NextNote soll die nächsten paar
	zu spielenden Noten herausfinden und dem audiocontext auftragen. Die Idee ist, dass nicht Noten in der fernen Zukunft schon gesetzt werden,
	damit das Tempo fortlaufend geändert werden kann.
	Die zu spielenden Noten sind in einer linearen Reihenfolge (Es gibt für jede Note eine Vorgängerin bzw Nachfolgerin). 
	Der Ablauf: Ich habe gerade eine Note an den audiocontext abgeschicht und möchte nun die nächste korrekt abschicken. Ich muss die 
	Zeit, die ich für die geschickte Note verwendet habe, um die richtige Zahl erhöhen. Dafür muss ich einen symbolischen Abstand zwischen
	den beiden Noten kennen und das aktuelle Tempo. Der maximale abstand zwischen zwei Noten ist 1. 
	
	Das Programm sollte immer an einer gewissen Position im Loop sein. 
*/

/*	positionPointer  
getNextNote 

*/

function get_control_values(html_ids){
	var results = {}
	html_ids.forEach(id => {
		results[id] = get_control_value(id)
	})
	return results
}

function get_control_value(html_id){
	var e = document.getElementById(html_id)
	if (e.nodeName === 'SELECT') return e.options[e.selectedIndex].value
	else if (e.nodeName === 'INPUT') return e.value
}

function set_control_value(html_id, value){
	var e = document.getElementById(html_id)
	e.value = value
	if (e.nodeName === 'SELECT') e.onchange()
	else if (e.nodeName === 'INPUT') e.oninput()
}

//Wie kann sichergestellt werden, dass die erste Note bei Start gespielt wird.
//die übernächste Note ebenfalls ermitteln, damit eine geschätzte duration ermittelt werden kann
//nextNote sollte nicht die globale variable nextNote verändern, sondern als argument deren aktuelle Werte erhalten und neue werte zurückgeben
function getNextNote () {
	var v=get_control_values(['beat_number', 'subdivision_number', 'swing_style', 'swing_percentage'])
			
	var full_swing_pattern=step_to_pattern(v.swing_style.repeat(v.beat_number))
	var morphed_pattern = apply_swing_to_pattern(full_swing_pattern, v.swing_percentage)
	var neutral_pattern = step_to_pattern('1'.repeat(morphed_pattern.length))
		
	var full_tick_number = v.beat_number * v.subdivision_number
	var next_position = morphed_pattern[positionPointer]
	if (positionPointer === 0) next_position += 1
	
	nextNote.time += (next_position - last_played_position) * cycleTime
	nextNote.sounds = get_sounds_at_col(positionPointer)
	//nextNote.duration = ...
	nextNote.position = positionPointer
	last_played_position = morphed_pattern[positionPointer]
	positionPointer = (positionPointer+1)%full_tick_number	
}

function schedule () {
	var schedLimit = audioContext.currentTime + (schedCycle / 1000) + schedOverlap
	while (nextNote.time < schedLimit) {
		nextNote.sounds.forEach(sound => {
		playBuffer(nextNote.time, sound)
		})
		blink_div(`subdiv_0;${nextNote.position}`, 200)	
		blink_div(`subdiv_1;${nextNote.position}`, 200)	
		blink_div(`subdiv_2;${nextNote.position}`, 200)	
	getNextNote()	
	}
}


function apply_swing_to_pattern(p, percentage){
	var morphed_pattern = []
	var neutral_p = step_to_pattern('1'.repeat(p.length))
	
	neutral_p.forEach(value => {
		var morphed = morph(neutral_p, p, value, percentage)
		morphed_pattern.push(morphed)
	})
	return morphed_pattern
}


function apply_grid_template_columns(fr_string, div_id){
	document.getElementById(div_id).style.gridTemplateColumns = fr_string
}

function get_grid_dimensions(){
	var v=get_control_values(['beat_number', 'subdivision_number'])
	var div_number=document.getElementById('wrapper').childElementCount
	var column_number = v.beat_number * v.subdivision_number
		//Anzahl Tracks als Attribut des html-elements gemerkt
	var w = document.getElementById('wrapper')
	var row_number = Number(w.dataset.tracknumber)
	return {total: div_number, rows:row_number, columns: column_number}
}


function plus_div_row(div_id){
	var w = document.getElementById('wrapper')
	//2020-11-24 Anzahl Tracks als Attribut des html-elements merken
	w.dataset.tracknumber=Number(w.dataset.tracknumber)+1
	var n = get_grid_dimensions()
	fill_in_divs(n.columns, n.rows, div_id)
	redraw_beat_patterns()
}

function click_div_manual(row, col){
	var id = `subdiv_${row};${col}`
	var div = document.getElementById(id)
	if (div) div.click()
}

function redraw_beat_patterns(){
	//var wrapper=document.getElementById(div_id)
	col_row.forEach ( (col,col_index) => col.forEach((row,row_index) => {
		if (row) click_div_manual(row_index, col_index)
		
	}) ) 
	
}

function fill_in_divs(col_number,row_number,div_id){
	var wrapper=document.getElementById(div_id)
	wrapper.innerHTML = "";
	for (var row=0; row<row_number; row++) {
		for (var col=0; col<col_number; col++){
			var current_id = `subdiv_${row};${col}`
			var new_div = document.createElement("div")
			new_div.id = current_id
			new_div.onmouseover=sub_div_mouseover
			new_div.onmouseout=sub_div_mouseout
			new_div.onclick=sub_div_clicked
			new_div.dataset.on='0'
			new_div.style.background = 'rgba(0,0,200,0.2)' //warum ist das sonst nicht gesetzt, steht ja im css?
			wrapper.appendChild(new_div)
		}
	}	
}

function get_subdiv_position(subdiv_id){
	var d = subdiv_id.split(/;|_/)
	return {row: d[1], col: d[2]}
}

function sub_div_mouseover(event){
	event.target.style.background='rgba(0,0,200,0.3)'
}

function sub_div_mouseout(event){
	if (event.target.dataset.on==='0') {
	event.target.style.background = 'rgba(0,0,200,0.2)'
	}
	//event.target.style.background = 'rgba(0,0,200,0.2)'
}

/*function add_subdiv_to_sound_array(subdiv_id){
	beat.push{}
}
*/
function sub_div_clicked(event){
	var p=get_subdiv_position(event.target.id)
	var sound = row_to_sound(p.row)
	if (event.target.dataset.on==='1') {
		event.target.dataset.on = '0'
		event.target.style.background = 'rgba(0,0,200,0.2)'
		col_row[p.col][p.row] = false
	} else {
		event.target.dataset.on = '1'
		event.target.style.background = 'rgba(0,0,200,0.3)'
		col_row[p.col][p.row] = true
	}
	
}

function blink_div(div_id, duration){
	light_up_div(div_id)
	setTimeout(function(){light_down_div(div_id)}, duration)
}

function light_up_div(div_id){
	var div = document.getElementById(div_id)
	if (!div) return
	var c = get_rgba_values(div.style.background)
	div.style.background = get_rgba_string (c.r, c.g, c.b, c.a-0.05)
}

function light_down_div(div_id){
	var div = document.getElementById(div_id)
	if (!div) return
	//abfangen, wenn div null ist. passiert wenn während isplaying die beat-anzahl geändert wird.
	var c = get_rgba_values(div.style.background)
	div.style.background = get_rgba_string (c.r, c.g, c.b, c.a+0.05)
}

function get_rgba_values(rgba){
	var d = rgba.split(/,|\(|\)/)
	return {
		r: parseFloat(d[1]),
		g: parseFloat(d[2]),
		b: parseFloat(d[3]),
		a: parseFloat(d[4])
	}
}

function get_rgba_string(r,g,b,a){
	return `rgba(${r},${g},${b},${a})`
}



//hier muss noch der Fall beachtet werden, dass die erste zahl nicht 0 ist.
function get_css_grid_fr_string(pattern) {
		var result=''
	pattern.forEach((current_value, current_index) => {
		var next_index = (current_index+1)%pattern.length
		var next_value = pattern[next_index]
		if (next_index==0) next_value = 1
		result = result + (next_value - current_value) + 'fr '
	})
	return result
}


function resizeContent () {
  var w = document.documentElement.clientWidth
  var h = document.documentElement.clientHeight
  canvas.width = 0.8 * w
  canvas.height = 0.8 * h
}

function test_draw_beat_queue (p, percentage) {
	context.clearRect(0, 0, canvas.width, canvas.height)
	var morphed_pattern = []
	var neutral_p = step_to_pattern('1'.repeat(p.length))
	
	neutral_p.forEach(value => {
		var morphed = morph(neutral_p, p, value, percentage)
		morphed_pattern.push(morphed)
	})
	//var p = step_to_pattern('2122212221222122')
	var y_1 = canvas.height/4
	var y_2 = canvas.height*3/4
	var x_1 = canvas.width/10
	var x_2 = canvas.width*9/10
	draw_beat_queue(y_1, y_2, x_1, x_2, morphed_pattern)
}

function draw_beat_queue(y_1, y_2, x_1, x_2, pattern) {
	var x_length = x_2 - x_1
	var y_length = y_2 - y_1
	pattern.forEach ( (cur_value, cur_index) => {
		var next_index = (cur_index+1)%pattern.length
		var next_value = pattern[next_index]
		if (next_index===0) next_value = 1
		var cur_length = next_value - cur_value
      	context.fillRect(x_1 + cur_value * x_length, y_1, cur_length * x_length - 2, y_length)	
	})
}
/*
try {
	console.log(getIndex (step_to_pattern('1111'),step_to_pattern('2121'), 3/4,1))
}
catch (err) {
	console.log (err)
}

morph ([0, 0.25, 0.5, 0.75],[0, 0.3333333333333333, 0.5, 0.6666666666666666],0.3333333333333333,0.69)
morph.js:214 morph output 4.166666666666666

*/

function getMousePos(canvas, evt) {
	var rect = canvas.getBoundingClientRect();
	return {
		x: evt.clientX - rect.left,
		y: evt.clientY - rect.top
	};
}

function key_check(event){
	var key_code = event.keyCode
	switch(key_code) {
	case 32: start()
		//38 up
		//40 down
		//39 right
		//37 left
	}
	
}


function morph (pattern_1, pattern_2, input_value, morph_percentage) {
	var perc, output_value
	if (input_value < 0 || input_value >= 1) throw "Punkt nicht in Spanne [0,1)"
	pattern_1.forEach( current_value => {if (current_value < 0 || current_value >= 1) throw "Zahlen nicht in Spanne [0,1)"})
	if (input_value < pattern_1[0]) input_value += 1
	pattern_1.forEach( (current_value_1,current_index) => {
	var current_value_2 = pattern_2[current_index]
	var next_index = (current_index+1)%pattern_1.length
	var next_value_1 = pattern_1[next_index]
	var next_value_2 = pattern_2[next_index]
	if (next_index===0) {
		next_value_1 += 1
		next_value_2 += 1 
	}
	//console.log("index", index,"next_index", next_index, "current_value ", current_value, "point", point,"next_val", next_val)
	if (input_value >= current_value_1 && input_value < next_value_1) { //umgebendes Wegstück ermittelt
		perc = (input_value-current_value_1)/(next_value_1-current_value_1)
		fully_morphed = current_value_2 + perc*(next_value_2 - current_value_2)
		output_value = input_value + morph_percentage * (fully_morphed - input_value)
	}
})
	return output_value
}

function binary_to_hex(bin_string){
	return bin_string.parseInt(2).toString(16)
}

function bpm_to_cycletime(bpm, bpc){
	/* emotional distraction
		für bpm beats -- 60 sec
		für 1 beat --> 60/bpm sec
		für bpc beats -- bpc * 60 / bpm
	*/
	return bpc * 60 / bpm
}

function step_to_pattern(patternString) {
	var units = patternString.split('')
	var size = 0
	units.forEach(
		(current_value, index) => {
			units[index] = Number(units[index])
			size += units[index]
		})

	var relPos = units.slice()
	var runningTot = 0
	relPos.forEach(
		(current_value, index) => {
			var memo = relPos[index]
			relPos[index] = runningTot / size
			runningTot += memo
		})
	return relPos
}


function get_morph_patterns(subdiv_number) {
	var patterns = ['1','2']
	for (var i = 1; i < subdiv_number; i++) {
		var temp = []
		patterns.forEach(elem => {
			temp.push(elem+'1')
			temp.push(elem+'2')
		})
		patterns = temp
	}
	return patterns
}

function playBuffer (time, sound, duration = 0.5) {
	var audioBuffer = audioBuffers[sound]
	const source = audioContext.createBufferSource()
	source.buffer = audioBuffer
	source.connect(audioContext.destination)
	source.start(time)
	source.stop(time + duration)
}

function playOsc (time, frequency = 440.0, duration=0.5) {
	var osc = audioContext.createOscillator()
	osc.connect(audioContext.destination) // defaults to speakers
	osc.frequency.value = frequency
	osc.start(time)
	osc.stop(time + duration) //sekunden
}

var soundFiles = {
	highhat: './samples/highhat.wav',
	snare: './samples/snare.wav',
	kick: './samples/kick.wav',
	e_clap: './samples/e_clap.wav',
	e_snare_d: './samples/e_snare_d.wav',	
	open_highhat_h: './samples/open_highhat_h.wav',
	e_cymbal: './samples/e_cymbal.wav',	
	e_snare_h: './samples/e_snare_h.wav',	
	e_kick_g: './samples/e_kick_g.wav',
	trap_highhat: './samples/trap_highhat.wav',
	e_kick_o: './samples/e_kick_o.wav',
	e_kick_s: './samples/e_kick_s.wav',
	open_highhat_d: './samples/open_highhat_d.wav'
}

//funktion manipuliert globale variable...
function get_sounds_at_col(col){
	result = []
	col_row[col].forEach ((row,index) => {
		if (row) result.push(row_to_sound(index))
	})
	return result
}

function row_to_sound(row_number){
	return ['trap_highhat','e_snare_d','e_kick_o'][row_number]
}

// this function should return a promise
function loadSounds () {
	Object.keys(soundFiles).forEach(key => {
		window.fetch(soundFiles[key])
		.then(response => response.arrayBuffer())
		.then(arrayBuffer => audioContext.decodeAudioData(arrayBuffer))
		.then(audioBuffer => {
		audioBuffers[key] = audioBuffer
		})
	})
}

function testAudio () {
	//return new Promise (function (resolver, rejecter){
	var starting = audioContext.currentTime
	playBuffer(starting + 1, 'highhat')
	playBuffer(starting + 2, 'snare')
	playBuffer(starting + 3, 'kick')
	//resolver('done')	
	//})
}